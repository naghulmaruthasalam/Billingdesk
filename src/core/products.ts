import { z } from 'zod';
import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { isoNow } from './time';
import { getSetting, putSetting } from './settings';
import { resolveDiscountBp, type DiscountRule } from '../shared/pricing';
import { recordMovement, lowStockCondition } from './inventory';

export interface ProductDTO {
  id: number;
  sku: string;
  barcode: string | null;
  nameEn: string;
  nameTa: string;
  categoryId: number;
  categoryName: string;
  categoryNameTa: string;
  unit: string;
  pricePaise: number | null;
  costPaise: number | null;
  stockQty: number;
  minStock: number;
  discountRule: DiscountRule;
  categoryDiscountRule: DiscountRule;
  /** Effective discount in basis points after product / category / shop rules. */
  effectiveDiscountBp: number;
  active: boolean;
  notes: string | null;
  printedNo: number | null;
  printedPricePaise: number | null;
  reviewStatus: 'ok' | 'needs_review';
  reviewReason: string | null;
  sortOrder: number;
  updatedAt: string;
}

interface ProductRow {
  id: number;
  sku: string;
  barcode: string | null;
  name_en: string;
  name_ta: string;
  category_id: number;
  category_name: string;
  category_name_ta: string;
  cat_rule: DiscountRule;
  cat_bp: number | null;
  unit: string;
  price_paise: number | null;
  cost_paise: number | null;
  stock_qty: number;
  min_stock: number;
  discount_rule: DiscountRule;
  active: number;
  notes: string | null;
  printed_no: number | null;
  printed_price_paise: number | null;
  review_status: 'ok' | 'needs_review';
  review_reason: string | null;
  sort_order: number;
  updated_at: string;
}

const SELECT_PRODUCT = `
SELECT p.id, p.sku, p.barcode, p.name_en, p.name_ta, p.category_id, c.name_en AS category_name, c.name_ta AS category_name_ta,
       c.discount_rule AS cat_rule, c.discount_bp AS cat_bp, p.unit, p.price_paise, p.cost_paise, p.stock_qty, p.min_stock,
       p.discount_rule, p.active, p.notes, p.printed_no, p.printed_price_paise, p.review_status, p.review_reason, p.sort_order, p.updated_at
FROM products p JOIN categories c ON c.id = p.category_id`;

function toDTO(r: ProductRow, defaultBp: number): ProductDTO {
  return {
    id: r.id,
    sku: r.sku,
    barcode: r.barcode,
    nameEn: r.name_en,
    nameTa: r.name_ta,
    categoryId: r.category_id,
    categoryName: r.category_name,
    categoryNameTa: r.category_name_ta,
    unit: r.unit,
    pricePaise: r.price_paise,
    costPaise: r.cost_paise,
    stockQty: r.stock_qty,
    minStock: r.min_stock,
    discountRule: r.discount_rule,
    categoryDiscountRule: r.cat_rule,
    effectiveDiscountBp: resolveDiscountBp({ productRule: r.discount_rule, categoryRule: r.cat_rule, categoryBp: r.cat_bp, defaultBp }),
    active: r.active === 1,
    notes: r.notes,
    printedNo: r.printed_no,
    printedPricePaise: r.printed_price_paise,
    reviewStatus: r.review_status,
    reviewReason: r.review_reason,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface ProductFilter {
  search?: string;
  categoryId?: number;
  activeOnly?: boolean;
  sellableOnly?: boolean;
  reviewOnly?: boolean;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Search by English name, Tamil name, SKU, barcode or printed serial ("#12"). Every whitespace-separated
 * token must match one of the fields (AND), so "10 cm col" finds "10 cm Colour".
 */
export function listProducts(db: Db, f: ProductFilter = {}): { rows: ProductDTO[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  const tokens = (f.search ?? '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
  for (const tk of tokens) {
    if (/^#\d+$/.test(tk)) {
      where.push('p.printed_no = ?');
      params.push(Number(tk.slice(1)));
      continue;
    }
    const like = `%${escapeLike(tk)}%`;
    where.push("(p.name_en LIKE ? ESCAPE '\\' OR p.name_ta LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode = ? OR c.name_en LIKE ? ESCAPE '\\' OR c.name_ta LIKE ? ESCAPE '\\')");
    params.push(like, like, like, tk, like, like);
  }
  if (f.categoryId) {
    where.push('p.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.activeOnly || f.sellableOnly) where.push('p.active = 1');
  if (f.sellableOnly) where.push('p.price_paise IS NOT NULL');
  if (f.reviewOnly) where.push("p.review_status = 'needs_review'");
  if (f.lowStockOnly) where.push(lowStockCondition('p'));
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) c FROM products p JOIN categories c ON c.id = p.category_id ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`${SELECT_PRODUCT} ${w} ORDER BY p.sort_order, p.id LIMIT ? OFFSET ?`).all(...params, f.limit ?? 1000, f.offset ?? 0) as ProductRow[];
  const defaultBp = getSetting(db, 'discount.default_bp');
  return { rows: rows.map((r) => toDTO(r, defaultBp)), total };
}

export function getProduct(db: Db, id: number): ProductDTO {
  const r = db.prepare(`${SELECT_PRODUCT} WHERE p.id = ?`).get(id) as ProductRow | undefined;
  if (!r) throw new AppError('NOT_FOUND', 'Product not found');
  return toDTO(r, getSetting(db, 'discount.default_bp'));
}

export function findByBarcodeOrSku(db: Db, code: string): ProductDTO | null {
  const r = db.prepare(`${SELECT_PRODUCT} WHERE (p.barcode = ? OR p.sku = ? COLLATE NOCASE) AND p.active = 1`).get(code, code) as ProductRow | undefined;
  return r ? toDTO(r, getSetting(db, 'discount.default_bp')) : null;
}

export const productInputSchema = z.object({
  sku: z.string().trim().max(40).optional(),
  barcode: z.string().trim().max(60).nullable().optional(),
  nameEn: z.string().trim().min(1, 'English name is required').max(160),
  nameTa: z.string().trim().max(160).default(''),
  categoryId: z.number().int().positive(),
  unit: z.string().trim().min(1).max(20),
  pricePaise: z.number().int().min(0).nullable(),
  costPaise: z.number().int().min(0).nullable().optional(),
  minStock: z.number().int().min(0).default(0),
  discountRule: z.enum(['inherit', 'eligible', 'never']).default('inherit'),
  active: z.boolean().default(true),
  notes: z.string().trim().max(500).nullable().optional(),
  openingStock: z.number().int().min(0).optional(),
});
export type ProductInput = z.infer<typeof productInputSchema>;

function nextSku(db: Db): string {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(sku, 4) AS INTEGER)) AS m FROM products WHERE sku GLOB 'SK-[0-9]*'").get() as { m: number | null };
  return `SK-${String((row.m ?? 0) + 1).padStart(3, '0')}`;
}

function wrapUnique(e: unknown): never {
  if (e instanceof Error && /UNIQUE constraint failed: products\.(sku|barcode)/.test(e.message)) {
    throw new AppError('CONFLICT', e.message.includes('barcode') ? 'Another product already uses this barcode' : 'Another product already uses this SKU');
  }
  throw e;
}

export function createProduct(ctx: Ctx, input: ProductInput): ProductDTO {
  const p = productInputSchema.parse(input);
  return tx(ctx.db, () => {
    const now = isoNow(ctx.now());
    const sku = p.sku || nextSku(ctx.db);
    let id: number;
    try {
      const sort = (ctx.db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 s FROM products').get() as { s: number }).s;
      id = Number(
        ctx.db
          .prepare('INSERT INTO products (sku, barcode, name_en, name_ta, category_id, unit, price_paise, cost_paise, stock_qty, min_stock, discount_rule, active, notes, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)')
          .run(sku, p.barcode || null, p.nameEn, p.nameTa, p.categoryId, p.unit, p.pricePaise, p.costPaise ?? null, p.minStock, p.discountRule, p.active ? 1 : 0, p.notes ?? null, sort, now, now).lastInsertRowid,
      );
    } catch (e) {
      wrapUnique(e);
    }
    audit(ctx, { action: 'product.create', entity: 'products', entityId: id!, details: { sku, nameEn: p.nameEn, pricePaise: p.pricePaise } });
    if (p.openingStock && p.openingStock > 0) {
      recordMovement(ctx, { productId: id!, type: 'opening', qtyDelta: p.openingStock, reason: 'Opening stock', refType: 'product', refId: id! });
    }
    return getProduct(ctx.db, id!);
  });
}

export function updateProduct(ctx: Ctx, id: number, input: Omit<ProductInput, 'openingStock'>): ProductDTO {
  const p = productInputSchema.omit({ openingStock: true }).parse(input);
  return tx(ctx.db, () => {
    const before = getProduct(ctx.db, id);
    try {
      ctx.db
        .prepare('UPDATE products SET sku=?, barcode=?, name_en=?, name_ta=?, category_id=?, unit=?, price_paise=?, cost_paise=?, min_stock=?, discount_rule=?, active=?, notes=?, updated_at=? WHERE id=?')
        .run(p.sku || before.sku, p.barcode || null, p.nameEn, p.nameTa, p.categoryId, p.unit, p.pricePaise, p.costPaise ?? null, p.minStock, p.discountRule, p.active ? 1 : 0, p.notes ?? null, isoNow(ctx.now()), id);
    } catch (e) {
      wrapUnique(e);
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const cmp = (k: string, a: unknown, b: unknown) => {
      if (a !== b) changes[k] = { from: a, to: b };
    };
    cmp('pricePaise', before.pricePaise, p.pricePaise);
    cmp('costPaise', before.costPaise, p.costPaise ?? null);
    cmp('discountRule', before.discountRule, p.discountRule);
    cmp('active', before.active, p.active);
    cmp('nameEn', before.nameEn, p.nameEn);
    cmp('nameTa', before.nameTa, p.nameTa);
    cmp('unit', before.unit, p.unit);
    cmp('categoryId', before.categoryId, p.categoryId);
    cmp('sku', before.sku, p.sku || before.sku);
    cmp('minStock', before.minStock, p.minStock);
    if (Object.keys(changes).length) {
      audit(ctx, { action: 'pricePaise' in changes ? 'product.price_change' : 'product.update', entity: 'products', entityId: id, details: changes });
    }
    return getProduct(ctx.db, id);
  });
}

export function setProductActive(ctx: Ctx, id: number, active: boolean): void {
  tx(ctx.db, () => {
    const info = ctx.db.prepare('UPDATE products SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, isoNow(ctx.now()), id);
    if (!info.changes) throw new AppError('NOT_FOUND', 'Product not found');
    audit(ctx, { action: 'product.active', entity: 'products', entityId: id, details: { active } });
  });
}

/** Mark catalogue entries as checked against the printed list (clears the review flag). */
export function markReviewed(ctx: Ctx, ids: number[]): number {
  return tx(ctx.db, () => {
    const st = ctx.db.prepare("UPDATE products SET review_status='ok', reviewed_by=?, reviewed_at=?, updated_at=? WHERE id=? AND review_status='needs_review'");
    let n = 0;
    const ts = isoNow(ctx.now());
    for (const id of ids) n += st.run(ctx.user.id, ts, ts, id).changes;
    if (n) audit(ctx, { action: 'catalogue.review', entity: 'products', details: { count: n, ids } });
    return n;
  });
}

export function flagForReview(ctx: Ctx, id: number, reason: string): void {
  tx(ctx.db, () => {
    ctx.db.prepare("UPDATE products SET review_status='needs_review', review_reason=?, updated_at=? WHERE id=?").run(reason, isoNow(ctx.now()), id);
    audit(ctx, { action: 'catalogue.flag', entity: 'products', entityId: id, details: { reason } });
  });
}

// ---------------------------------------------------------------- categories

export interface CategoryDTO {
  id: number;
  nameEn: string;
  nameTa: string;
  sortOrder: number;
  note: string | null;
  discountRule: DiscountRule;
  discountBp: number | null;
  active: boolean;
  productCount: number;
}

export function listCategories(db: Db): CategoryDTO[] {
  return (
    db
      .prepare('SELECT c.id, c.name_en, c.name_ta, c.sort_order, c.note, c.discount_rule, c.discount_bp, c.active, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS n FROM categories c ORDER BY c.sort_order, c.id')
      .all() as { id: number; name_en: string; name_ta: string; sort_order: number; note: string | null; discount_rule: DiscountRule; discount_bp: number | null; active: number; n: number }[]
  ).map((r) => ({ id: r.id, nameEn: r.name_en, nameTa: r.name_ta, sortOrder: r.sort_order, note: r.note, discountRule: r.discount_rule, discountBp: r.discount_bp, active: r.active === 1, productCount: r.n }));
}

export const categoryInputSchema = z.object({
  nameEn: z.string().trim().min(1).max(80),
  nameTa: z.string().trim().max(80).default(''),
  note: z.string().trim().max(200).nullable().optional(),
  discountRule: z.enum(['inherit', 'eligible', 'never']).default('inherit'),
  discountBp: z.number().int().min(0).max(10000).nullable().optional(),
  active: z.boolean().default(true),
});

export function saveCategory(ctx: Ctx, id: number | null, input: z.input<typeof categoryInputSchema>): CategoryDTO {
  const c = categoryInputSchema.parse(input);
  const rid = tx(ctx.db, () => {
    const ts = isoNow(ctx.now());
    let cid = id;
    try {
      if (id) {
        const before = ctx.db.prepare('SELECT discount_rule, discount_bp FROM categories WHERE id = ?').get(id) as { discount_rule: string; discount_bp: number | null } | undefined;
        if (!before) throw new AppError('NOT_FOUND', 'Category not found');
        ctx.db.prepare('UPDATE categories SET name_en=?, name_ta=?, note=?, discount_rule=?, discount_bp=?, active=?, updated_at=? WHERE id=?').run(c.nameEn, c.nameTa, c.note ?? null, c.discountRule, c.discountBp ?? null, c.active ? 1 : 0, ts, id);
        if (before.discount_rule !== c.discountRule || before.discount_bp !== (c.discountBp ?? null)) {
          audit(ctx, { action: 'category.discount_rule', entity: 'categories', entityId: id, details: { from: before, to: { rule: c.discountRule, bp: c.discountBp ?? null } } });
        }
      } else {
        const sort = (ctx.db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 s FROM categories').get() as { s: number }).s;
        cid = Number(ctx.db.prepare('INSERT INTO categories (name_en, name_ta, sort_order, note, discount_rule, discount_bp, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(c.nameEn, c.nameTa, sort, c.note ?? null, c.discountRule, c.discountBp ?? null, c.active ? 1 : 0, ts, ts).lastInsertRowid);
        audit(ctx, { action: 'category.create', entity: 'categories', entityId: cid, details: { nameEn: c.nameEn } });
      }
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) throw new AppError('CONFLICT', 'A category with this name already exists');
      throw e;
    }
    return cid!;
  });
  return listCategories(ctx.db).find((x) => x.id === rid)!;
}

// ------------------------------------------------------------ catalogue status

export interface CatalogueStatus {
  approved: boolean;
  addressConfirmed: boolean;
  totalProducts: number;
  needsReview: number;
  missingPrice: number;
  withoutStockEntered: number;
  changedFromPrinted: number;
}

export function catalogueStatus(db: Db): CatalogueStatus {
  const q = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  return {
    approved: getSetting(db, 'setup.catalogue_approved'),
    addressConfirmed: getSetting(db, 'setup.address_confirmed'),
    totalProducts: q('SELECT COUNT(*) c FROM products WHERE active = 1'),
    needsReview: q("SELECT COUNT(*) c FROM products WHERE review_status = 'needs_review'"),
    missingPrice: q('SELECT COUNT(*) c FROM products WHERE active = 1 AND price_paise IS NULL'),
    withoutStockEntered: q("SELECT COUNT(*) c FROM products WHERE active = 1 AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = products.id)"),
    changedFromPrinted: q('SELECT COUNT(*) c FROM products WHERE printed_price_paise IS NOT NULL AND (price_paise IS NULL OR price_paise <> printed_price_paise)'),
  };
}

/** Owner approval: allows real billing to start. Requires every flagged entry to be confirmed first. */
export function setCatalogueApproved(ctx: Ctx, approved: boolean): CatalogueStatus {
  tx(ctx.db, () => {
    if (approved) {
      const st = catalogueStatus(ctx.db);
      if (st.needsReview > 0) throw new AppError('VALIDATION', `${st.needsReview} catalogue entries are still marked for review. Confirm or correct them first.`);
      if (st.missingPrice > 0) throw new AppError('VALIDATION', `${st.missingPrice} active products have no price. Enter a price or deactivate them.`);
    }
    putSetting(ctx.db, ctx.now(), 'setup.catalogue_approved', approved);
    audit(ctx, { action: approved ? 'catalogue.approve' : 'catalogue.unapprove', entity: 'catalogue' });
  });
  return catalogueStatus(ctx.db);
}
