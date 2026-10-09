import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { seedRoles } from './auth';
import { getSetting, putSetting, SETTING_DEFAULTS, SETTINGS_SCHEMA, type SettingKey } from './settings';
import { isoNow } from './time';
import { auditSystem, audit } from './audit';
import { SEED_CATEGORIES, SEED_PRODUCTS } from '../shared/catalogue';

export const seedSku = (no: number): string => `SK-${String(no).padStart(3, '0')}`;

/** Idempotent first-run seeding of roles, shop settings, categories and the verified catalogue. */
export function ensureSeeded(db: Db, now: Date): { seededProducts: number } {
  seedRoles(db);
  let seeded = 0;
  tx(db, () => {
    for (const k of Object.keys(SETTINGS_SCHEMA) as SettingKey[]) {
      const has = db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k);
      if (!has && k !== 'auth.recovery_hash') putSetting(db, now, k, SETTING_DEFAULTS[k] as never);
    }
    if (getSetting(db, 'catalogue.seeded')) return;
    const ts = isoNow(now);
    const catIds = new Map<string, number>();
    SEED_CATEGORIES.forEach((c, i) => {
      const note = [c.note, c.review].filter(Boolean).join(' | ') || null;
      db.prepare('INSERT INTO categories (name_en, name_ta, sort_order, note, discount_rule, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(name_en) DO NOTHING').run(c.nameEn, c.nameTa, i + 1, note, c.discountRule, ts, ts);
      const id = (db.prepare('SELECT id FROM categories WHERE name_en = ?').get(c.nameEn) as { id: number }).id;
      catIds.set(c.key, id);
    });
    const ins = db.prepare(
      'INSERT INTO products (sku, name_en, name_ta, category_id, unit, price_paise, stock_qty, min_stock, discount_rule, active, notes, printed_no, printed_price_paise, sort_order, review_status, review_reason, created_at, updated_at) VALUES (?,?,?,?,?,?,0,0,?,1,?,?,?,?,?,?,?,?)',
    );
    SEED_PRODUCTS.forEach((p, i) => {
      const cat = SEED_CATEGORIES.find((c) => c.key === p.cat)!;
      const exists = db.prepare('SELECT 1 FROM products WHERE sku = ?').get(seedSku(p.no));
      if (exists) return;
      const note = cat.note ? `${cat.nameEn}: ${cat.note}` : null;
      ins.run(seedSku(p.no), p.en, p.ta, catIds.get(p.cat), p.unit ?? cat.defaultUnit, p.rate * 100, 'inherit', note, p.no, p.rate * 100, i + 1, p.review ? 'needs_review' : 'ok', p.review ?? null, ts, ts);
      seeded++;
    });
    putSetting(db, now, 'catalogue.seeded', true);
    auditSystem(db, now, 'catalogue.seed', null, { products: seeded, source: 'printed 2025 price list' });
  });
  return { seededProducts: seeded };
}

/**
 * Restore every catalogue entry that came from the printed list to its printed name, unit, rate and review
 * state. Stock, sales history and manually added products are untouched.
 */
export function resetCatalogueToPrinted(ctx: Ctx): { restored: number } {
  return tx(ctx.db, () => {
    const ts = isoNow(ctx.now());
    let n = 0;
    SEED_PRODUCTS.forEach((p) => {
      const cat = SEED_CATEGORIES.find((c) => c.key === p.cat)!;
      const catId = (ctx.db.prepare('SELECT id FROM categories WHERE name_en = ?').get(cat.nameEn) as { id: number } | undefined)?.id;
      if (!catId) return;
      const info = ctx.db
        .prepare("UPDATE products SET name_en=?, name_ta=?, category_id=?, unit=?, price_paise=?, discount_rule='inherit', active=1, review_status=?, review_reason=?, updated_at=? WHERE sku=?")
        .run(p.en, p.ta, catId, p.unit ?? cat.defaultUnit, p.rate * 100, p.review ? 'needs_review' : 'ok', p.review ?? null, ts, seedSku(p.no));
      n += info.changes;
    });
    putSetting(ctx.db, ctx.now(), 'setup.catalogue_approved', false);
    audit(ctx, { action: 'catalogue.reset_to_printed', entity: 'catalogue', details: { restored: n } });
    return { restored: n };
  });
}
