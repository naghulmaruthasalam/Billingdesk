import { z } from 'zod';
import type { Db } from './db/connection';
import type { Ctx } from './types';
import { audit } from './audit';
import { isoNow } from './time';
import { AppError } from './errors';

/** Every setting with its type, default and validation. Stored as JSON text in the `settings` table. */
export const SETTINGS_SCHEMA = {
  'shop.name_en': z.string().trim().min(1).max(120),
  'shop.name_ta': z.string().trim().max(120),
  'shop.address': z.string().trim().max(400),
  'shop.address_ta': z.string().trim().max(400),
  'shop.phones': z.array(z.string().trim().max(30)).max(6),
  'shop.tax_id': z.string().trim().max(40),
  'shop.logo_data_url': z.string().max(600_000),
  'invoice.footer_en': z.string().trim().max(200),
  'invoice.footer_ta': z.string().trim().max(200),
  'invoice.prefix': z.string().trim().regex(/^[A-Za-z0-9-]{0,10}$/, 'Prefix may contain letters, digits and hyphen only'),
  'invoice.pad': z.number().int().min(1).max(10),
  'invoice.receipt_size': z.enum(['58mm', '80mm', 'a4']),
  'invoice.show_tamil': z.boolean(),
  'setup.address_confirmed': z.boolean(),
  'setup.catalogue_approved': z.boolean(),
  'discount.default_bp': z.number().int().min(0).max(10000),
  'discount.rounding_scope': z.enum(['line', 'invoice']),
  'discount.rounding_unit': z.enum(['paisa', 'rupee']),
  'tax.enabled': z.boolean(),
  'tax.label': z.string().trim().min(1).max(20),
  'tax.rate_bp': z.number().int().min(0).max(10000),
  'tax.inclusive': z.boolean(),
  'billing.stock_enforcement': z.enum(['enforce', 'warn']),
  'billing.allow_credit': z.boolean(),
  'backup.auto_enabled': z.boolean(),
  'backup.retention_count': z.number().int().min(1).max(365),
  'backup.directory': z.string().max(500),
  'backup.last_auto_date': z.string().max(10),
  'ui.theme': z.enum(['light', 'dark', 'system']),
  'auth.recovery_hash': z.string().max(200),
  'catalogue.seeded': z.boolean(),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS_SCHEMA)[K]>;

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  'shop.name_en': 'Sri Krishna Pattasu Kadai',
  'shop.name_ta': 'ஸ்ரீ கிருஷ்ணா பட்டாசு கடை',
  // Transcribed from a photograph of the brochure. The owner must confirm before invoice printing is enabled.
  'shop.address': '4/210, J.V. Complex, Gurunthasala Nagar, N.G.G.O. Colony Main Road, Kovaipudur, Coimbatore - 641017.',
  'shop.address_ta': '4/210, ஜே.வி. காம்பளக்ஸ், குருந்தாசல நகர், என்.ஜி.ஜி.ஓ. காலனி மெயின் ரோடு, கோயம்புத்தூர் - 641017.',
  'shop.phones': ['98426 81816', '98437 81816'],
  'shop.tax_id': '',
  'shop.logo_data_url': '',
  'invoice.footer_en': 'Thank you. Celebrate safely!',
  'invoice.footer_ta': 'அனைவருக்கும் தீபாவளி நல்வாழ்த்துக்கள்',
  'invoice.prefix': 'SKP',
  'invoice.pad': 6,
  'invoice.receipt_size': '80mm',
  'invoice.show_tamil': true,
  'setup.address_confirmed': false,
  'setup.catalogue_approved': false,
  'discount.default_bp': 1000,
  'discount.rounding_scope': 'line',
  'discount.rounding_unit': 'paisa',
  'tax.enabled': false,
  'tax.label': 'GST',
  'tax.rate_bp': 0,
  'tax.inclusive': false,
  'billing.stock_enforcement': 'enforce',
  'billing.allow_credit': false,
  'backup.auto_enabled': true,
  'backup.retention_count': 14,
  'backup.directory': '',
  'backup.last_auto_date': '',
  'ui.theme': 'light',
  'auth.recovery_hash': '',
  'catalogue.seeded': false,
};

/** Keys that are never returned to the renderer. */
const HIDDEN: SettingKey[] = ['auth.recovery_hash'];

export function getSetting<K extends SettingKey>(db: Db, key: K): SettingValue<K> {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return SETTING_DEFAULTS[key];
  try {
    const parsed = SETTINGS_SCHEMA[key].safeParse(JSON.parse(row.value));
    if (parsed.success) return parsed.data as SettingValue<K>;
  } catch {
    /* fall through to default */
  }
  return SETTING_DEFAULTS[key];
}

export function putSetting<K extends SettingKey>(db: Db, now: Date, key: K, value: SettingValue<K>): void {
  const v = SETTINGS_SCHEMA[key].parse(value);
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, JSON.stringify(v), isoNow(now));
}

export type AllSettings = { [K in Exclude<SettingKey, 'auth.recovery_hash'>]: SettingValue<K> };

export function getAllSettings(db: Db): AllSettings {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(SETTINGS_SCHEMA) as SettingKey[]) {
    if (HIDDEN.includes(k)) continue;
    out[k] = getSetting(db, k);
  }
  return out as AllSettings;
}

/** Settings that, when changed, invalidate earlier owner confirmations. */
const ADDRESS_KEYS: SettingKey[] = ['shop.address', 'shop.address_ta', 'shop.name_en', 'shop.name_ta', 'shop.phones'];
/** Keys only writable through dedicated, audited workflows. */
const PROTECTED: SettingKey[] = ['auth.recovery_hash', 'catalogue.seeded', 'setup.catalogue_approved', 'backup.last_auto_date'];

export function updateSettings(ctx: Ctx, patch: Record<string, unknown>): AllSettings {
  const entries = Object.entries(patch);
  ctx.db.transaction(() => {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, raw] of entries) {
      if (!(key in SETTINGS_SCHEMA) || PROTECTED.includes(key as SettingKey)) throw new AppError('VALIDATION', `Unknown or protected setting: ${key}`);
      const k = key as SettingKey;
      const parsed = SETTINGS_SCHEMA[k].safeParse(raw);
      if (!parsed.success) throw new AppError('VALIDATION', `Invalid value for ${key}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const prev = getSetting(ctx.db, k);
      if (JSON.stringify(prev) === JSON.stringify(parsed.data)) continue;
      putSetting(ctx.db, ctx.now(), k, parsed.data as never);
      changes[key] = { from: key === 'shop.logo_data_url' ? '(logo)' : prev, to: key === 'shop.logo_data_url' ? '(logo)' : parsed.data };
    }
    // Editing address/identity details withdraws the confirmation unless the same call re-confirms it.
    if (Object.keys(changes).some((k) => ADDRESS_KEYS.includes(k as SettingKey)) && !('setup.address_confirmed' in patch)) {
      putSetting(ctx.db, ctx.now(), 'setup.address_confirmed', false);
    }
    if (Object.keys(changes).length) audit(ctx, { action: 'settings.update', entity: 'settings', details: changes });
  })();
  return getAllSettings(ctx.db);
}
