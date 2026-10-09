import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { csvToObjects, parseCsv, toCsv } from './csv';
import { isoNow } from './time';
import { paiseToDecimal, parseRupees } from '../shared/money';

export const CATALOGUE_COLUMNS = ['sku', 'barcode', 'name_en', 'name_ta', 'category', 'unit', 'price', 'cost', 'min_stock', 'discount_rule', 'active', 'notes', 'printed_no', 'printed_price', 'review_status'] as const;

export function exportCatalogueCsv(db: Db): string {
  const rows = db
    .prepare('SELECT p.*, c.name_en AS cat FROM products p JOIN categories c ON c.id = p.category_id ORDER BY p.sort_order, p.id')
    .all() as Record<string, unknown>[];
  const money = (v: unknown) => (v === null || v === undefined ? '' : paiseToDecimal(v as number));
  return toCsv([
    [...CATALOGUE_COLUMNS],
    ...rows.map((r) => [r.sku, r.barcode ?? '', r.name_en, r.name_ta, r.cat, r.unit, money(r.price_paise), money(r.cost_paise), r.min_stock, r.discount_rule, r.active === 1 ? 'yes' : 'no', r.notes ?? '', r.printed_no ?? '', money(r.printed_price_paise), r.review_status]),
  ]);
}

export interface ImportIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface ImportRow {
  line: number;
  action: 'create' | 'update' | 'unchanged' | 'error';
  sku: string;
  nameEn: string;
  nameTa: string;
  category: string;
  unit: string;
  pricePaise: number | null;
  costPaise: number | null;
  minStock: number;
  discountRule: 'inherit' | 'eligible' | 'never';
  active: boolean;
  barcode: string | null;
  notes: string | null;
  changes: { field: string; from: string; to: string }[];
  issues: ImportIssue[];
  /** Entry should be flagged for owner review after import. */
  uncertain: boolean;
}

export interface ImportPreview {
  rows: ImportRow[];
  summary: { total: number; create: number; update: number; unchanged: number; errors: number; warnings: number; missingPrice: number };
  newCategories: string[];
}

const yes = (s: string) => /^(1|y|yes|true|active)$/i.test(s.trim());
const no = (s: string) => /^(0|n|no|false|inactive)$/i.test(s.trim());
const norm = (s: string) => s.normalize('NFC').trim();

export function previewCatalogueCsv(db: Db, text: string): ImportPreview {
  const { headers, records } = csvToObjects(parseCsv(text));
  if (headers.length === 0) throw new AppError('VALIDATION', 'The file is empty');
  for (const req of ['name_en', 'category'] as const) {
    if (!headers.includes(req)) throw new AppError('VALIDATION', `Missing required column: ${req}`);
  }
  const cats = new Map((db.prepare('SELECT id, name_en FROM categories').all() as { id: number; name_en: string }[]).map((c) => [c.name_en.toLowerCase(), c.id]));
  const existing = new Map((db.prepare('SELECT p.*, c.name_en AS cat FROM products p JOIN categories c ON c.id = p.category_id').all() as Record<string, unknown>[]).map((p) => [String(p.sku).toLowerCase(), p]));
  const byBarcode = new Map((db.prepare('SELECT sku, barcode FROM products WHERE barcode IS NOT NULL').all() as { sku: string; barcode: string }[]).map((p) => [p.barcode, p.sku.toLowerCase()]));
  const dbNames = db.prepare('SELECT sku FROM products WHERE lower(name_en) = lower(?) AND category_id = ?');
  const seenSku = new Set<string>();
  const seenBarcode = new Set<string>();
  const seenName = new Set<string>();
  const newCats = new Set<string>();
  let autoSku = (db.prepare("SELECT MAX(CAST(SUBSTR(sku, 4) AS INTEGER)) AS m FROM products WHERE sku GLOB 'SK-[0-9]*'").get() as { m: number | null }).m ?? 0;

  const rows: ImportRow[] = records.map((r, i) => {
    const issues: ImportIssue[] = [];
    const err = (m: string) => issues.push({ severity: 'error', message: m });
    const warn = (m: string) => issues.push({ severity: 'warning', message: m });
    const nameEn = norm(r.name_en ?? '');
    const nameTa = norm(r.name_ta ?? '');
    const category = norm(r.category ?? '');
    let sku = norm(r.sku ?? '');
    if (!nameEn) err('English name is missing');
    if (!category) err('Category is missing');
    else if (!cats.has(category.toLowerCase())) {
      newCats.add(category);
      warn(`New category "${category}" will be created`);
    }
    if (!sku) {
      autoSku += 1;
      sku = `SK-${String(autoSku).padStart(3, '0')}`;
      warn(`No SKU given - ${sku} will be assigned`);
    }
    if (seenSku.has(sku.toLowerCase())) err(`Duplicate SKU "${sku}" in this file`);
    seenSku.add(sku.toLowerCase());

    let pricePaise: number | null = null;
    if ((r.price ?? '') === '') warn('Price is missing - the product cannot be sold until a price is entered');
    else {
      pricePaise = parseRupees(r.price);
      if (pricePaise === null || pricePaise < 0) {
        err(`Invalid price "${r.price}"`);
        pricePaise = null;
      }
    }
    let costPaise: number | null = null;
    if ((r.cost ?? '') !== '') {
      costPaise = parseRupees(r.cost);
      if (costPaise === null || costPaise < 0) {
        err(`Invalid cost "${r.cost}"`);
        costPaise = null;
      }
    }
    let minStock = 0;
    if ((r.min_stock ?? '') !== '') {
      if (/^\d+$/.test(r.min_stock)) minStock = Number(r.min_stock);
      else err(`Invalid minimum stock "${r.min_stock}"`);
    }
    let rule: ImportRow['discountRule'] = 'inherit';
    const rawRule = (r.discount_rule ?? '').toLowerCase();
    if (rawRule) {
      if (rawRule === 'inherit' || rawRule === 'eligible' || rawRule === 'never') rule = rawRule;
      else err(`Discount rule must be inherit, eligible or never (got "${r.discount_rule}")`);
    }
    let active = true;
    if ((r.active ?? '') !== '') {
      if (yes(r.active)) active = true;
      else if (no(r.active)) active = false;
      else err(`Active must be yes or no (got "${r.active}")`);
    }
    const barcode = norm(r.barcode ?? '') || null;
    if (barcode) {
      if (seenBarcode.has(barcode)) err(`Duplicate barcode "${barcode}" in this file`);
      seenBarcode.add(barcode);
      const owner = byBarcode.get(barcode);
      if (owner && owner !== sku.toLowerCase()) err(`Barcode "${barcode}" already belongs to ${owner.toUpperCase()}`);
    }
    const unit = norm(r.unit ?? '') || 'Box';

    // Uncertain-name heuristics: these entries are imported but flagged for owner review.
    let uncertain = false;
    if (nameEn && (/[?�]/.test(nameEn) || nameEn.length < 2 || /[^\x20-\x7E¼-¾½″"']/.test(nameEn))) {
      uncertain = true;
      warn('English name contains unusual characters - please check the spelling');
    }
    if (nameEn && !nameTa) warn('Tamil name is missing');
    if (nameTa && /[?�]/.test(nameTa)) {
      uncertain = true;
      warn('Tamil name contains unreadable characters');
    }
    const nameKey = `${category.toLowerCase()}|${nameEn.toLowerCase()}`;
    if (seenName.has(nameKey)) warn(`"${nameEn}" appears more than once in this category in the file`);
    seenName.add(nameKey);
    const catId = cats.get(category.toLowerCase());
    if (catId && nameEn) {
      const dup = dbNames.all(nameEn, catId) as { sku: string }[];
      if (dup.some((d) => d.sku.toLowerCase() !== sku.toLowerCase())) warn(`A product named "${nameEn}" already exists in this category under a different SKU`);
    }

    const cur = existing.get(sku.toLowerCase());
    const changes: ImportRow['changes'] = [];
    const diff = (field: string, from: unknown, to: unknown) => {
      const a = from === null || from === undefined ? '' : String(from);
      const b = to === null || to === undefined ? '' : String(to);
      if (a !== b) changes.push({ field, from: a, to: b });
    };
    if (cur) {
      diff('name_en', cur.name_en, nameEn);
      diff('name_ta', cur.name_ta, nameTa);
      diff('category', cur.cat, cats.has(category.toLowerCase()) ? (db.prepare('SELECT name_en FROM categories WHERE id = ?').get(cats.get(category.toLowerCase())) as { name_en: string }).name_en : category);
      diff('unit', cur.unit, unit);
      diff('price', cur.price_paise === null ? '' : paiseToDecimal(cur.price_paise as number), pricePaise === null ? '' : paiseToDecimal(pricePaise));
      if (headers.includes('cost')) diff('cost', cur.cost_paise === null ? '' : paiseToDecimal(cur.cost_paise as number), costPaise === null ? '' : paiseToDecimal(costPaise));
      if (headers.includes('min_stock')) diff('min_stock', cur.min_stock, minStock);
      if (headers.includes('discount_rule')) diff('discount_rule', cur.discount_rule, rule);
      if (headers.includes('active')) diff('active', cur.active === 1 ? 'yes' : 'no', active ? 'yes' : 'no');
      if (headers.includes('barcode')) diff('barcode', cur.barcode, barcode);
    }
    const hasError = issues.some((x) => x.severity === 'error');
    return {
      line: i + 2,
      action: hasError ? 'error' : cur ? (changes.length ? 'update' : 'unchanged') : 'create',
      sku,
      nameEn,
      nameTa,
      category,
      unit,
      pricePaise,
      costPaise,
      minStock,
      discountRule: rule,
      active,
      barcode,
      notes: norm(r.notes ?? '') || null,
      changes,
      issues,
      uncertain,
    };
  });
  const count = (a: ImportRow['action']) => rows.filter((r) => r.action === a).length;
  return {
    rows,
    newCategories: [...newCats],
    summary: {
      total: rows.length,
      create: count('create'),
      update: count('update'),
      unchanged: count('unchanged'),
      errors: count('error'),
      warnings: rows.filter((r) => r.issues.some((x) => x.severity === 'warning')).length,
      missingPrice: rows.filter((r) => r.pricePaise === null && r.action !== 'error').length,
    },
  };
}

/** Apply a catalogue CSV. The file is re-validated here; rows with errors are skipped, never partially applied. */
export function commitCatalogueCsv(ctx: Ctx, text: string, opts: { acceptWarnings: boolean }): { created: number; updated: number; skipped: number } {
  const preview = previewCatalogueCsv(ctx.db, text);
  const withWarnings = preview.rows.filter((r) => r.action !== 'error' && r.issues.some((i) => i.severity === 'warning'));
  if (withWarnings.length && !opts.acceptWarnings) throw new AppError('VALIDATION', 'The import has warnings that must be accepted first');
  const { headers } = csvToObjects(parseCsv(text));
  return tx(ctx.db, () => {
    const ts = isoNow(ctx.now());
    let created = 0;
    let updated = 0;
    const catId = (name: string): number => {
      const row = ctx.db.prepare('SELECT id FROM categories WHERE name_en = ? COLLATE NOCASE').get(name) as { id: number } | undefined;
      if (row) return row.id;
      const sort = (ctx.db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 s FROM categories').get() as { s: number }).s;
      const id = Number(ctx.db.prepare('INSERT INTO categories (name_en, name_ta, sort_order, created_at, updated_at) VALUES (?,?,?,?,?)').run(name, '', sort, ts, ts).lastInsertRowid);
      audit(ctx, { action: 'category.create', entity: 'categories', entityId: id, details: { nameEn: name, via: 'import' } });
      return id;
    };
    for (const r of preview.rows) {
      if (r.action === 'error' || r.action === 'unchanged') continue;
      const reviewStatus = r.uncertain ? 'needs_review' : 'ok';
      const reason = r.uncertain ? r.issues.filter((i) => i.severity === 'warning').map((i) => i.message).join('; ') : null;
      const cid = catId(r.category);
      if (r.action === 'create') {
        const sort = (ctx.db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 s FROM products').get() as { s: number }).s;
        ctx.db
          .prepare('INSERT INTO products (sku, barcode, name_en, name_ta, category_id, unit, price_paise, cost_paise, stock_qty, min_stock, discount_rule, active, notes, sort_order, review_status, review_reason, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?)')
          .run(r.sku, r.barcode, r.nameEn, r.nameTa, cid, r.unit, r.pricePaise, r.costPaise, r.minStock, r.discountRule, r.active ? 1 : 0, r.notes, sort, reviewStatus, reason, ts, ts);
        created++;
      } else {
        const cur = ctx.db.prepare('SELECT id, price_paise, cost_paise, review_status FROM products WHERE sku = ? COLLATE NOCASE').get(r.sku) as { id: number; price_paise: number | null; cost_paise: number | null; review_status: string };
        ctx.db
          .prepare('UPDATE products SET name_en=?, name_ta=?, category_id=?, unit=?, price_paise=?, cost_paise=CASE WHEN ? THEN ? ELSE cost_paise END, min_stock=CASE WHEN ? THEN ? ELSE min_stock END, discount_rule=CASE WHEN ? THEN ? ELSE discount_rule END, active=CASE WHEN ? THEN ? ELSE active END, barcode=CASE WHEN ? THEN ? ELSE barcode END, review_status=?, review_reason=?, updated_at=? WHERE id=?')
          .run(r.nameEn, r.nameTa, cid, r.unit, r.pricePaise, headers.includes('cost') ? 1 : 0, r.costPaise, headers.includes('min_stock') ? 1 : 0, r.minStock, headers.includes('discount_rule') ? 1 : 0, r.discountRule, headers.includes('active') ? 1 : 0, r.active ? 1 : 0, headers.includes('barcode') ? 1 : 0, r.barcode, reviewStatus, reason, ts, cur.id);
        const priceChange = r.changes.find((c) => c.field === 'price');
        if (priceChange) audit(ctx, { action: 'product.price_change', entity: 'products', entityId: cur.id, details: { from: cur.price_paise, to: r.pricePaise, via: 'import' } });
        updated++;
      }
    }
    audit(ctx, { action: 'catalogue.import', entity: 'catalogue', details: { created, updated, skipped: preview.summary.errors } });
    return { created, updated, skipped: preview.summary.errors };
  });
}
