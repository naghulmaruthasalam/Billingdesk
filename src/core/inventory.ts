import { z } from 'zod';
import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { businessDate, isoNow, isDateString, istRangeToUtc } from './time';
import { csvToObjects, parseCsv } from './csv';

export type MovementType = 'opening' | 'purchase' | 'sale' | 'sale_cancel' | 'return_restock' | 'return_damaged' | 'adjustment' | 'damage' | 'expiry' | 'count_correction';

export interface MovementInput {
  productId: number;
  type: MovementType;
  qtyDelta: number;
  reason: string;
  refType?: string | null;
  refId?: number | null;
}

/**
 * The single place where stock changes. Writes the immutable movement row and the cached product stock
 * together. Must run inside a transaction opened by the caller.
 */
export function recordMovement(ctx: Pick<Ctx, 'db' | 'user' | 'now'>, m: MovementInput): number {
  if (!Number.isInteger(m.qtyDelta)) throw new AppError('VALIDATION', 'Stock quantity must be a whole number');
  if (!m.reason.trim()) throw new AppError('VALIDATION', 'A reason is required for every stock change');
  const row = ctx.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(m.productId) as { stock_qty: number } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Product not found');
  const after = row.stock_qty + m.qtyDelta;
  const now = ctx.now();
  ctx.db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(after, isoNow(now), m.productId);
  ctx.db
    .prepare('INSERT INTO inventory_movements (product_id, movement_type, qty_delta, qty_after, reason, ref_type, ref_id, business_date, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(m.productId, m.type, m.qtyDelta, after, m.reason.trim(), m.refType ?? null, m.refId ?? null, businessDate(now), isoNow(now), ctx.user.id);
  return after;
}

export const adjustSchema = z.object({
  productId: z.number().int().positive(),
  /** 'delta' applies +/- quantity; 'set' sets the counted stock level. */
  mode: z.enum(['delta', 'set']),
  qty: z.number().int(),
  type: z.enum(['adjustment', 'damage', 'expiry']).default('adjustment'),
  reason: z.string().trim().min(3, 'Please give a reason (at least 3 characters)').max(300),
});

export function adjustStock(ctx: Ctx, input: z.input<typeof adjustSchema>): { stockQty: number } {
  const a = adjustSchema.parse(input);
  return tx(ctx.db, () => {
    const cur = ctx.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(a.productId) as { stock_qty: number } | undefined;
    if (!cur) throw new AppError('NOT_FOUND', 'Product not found');
    const delta = a.mode === 'set' ? a.qty - cur.stock_qty : a.qty;
    if (a.mode === 'set' && a.qty < 0) throw new AppError('VALIDATION', 'Stock cannot be set to a negative number');
    if ((a.type === 'damage' || a.type === 'expiry') && delta >= 0) throw new AppError('VALIDATION', 'Damaged/expired stock must reduce the stock level');
    if (delta === 0) throw new AppError('VALIDATION', 'No change in quantity');
    if (cur.stock_qty + delta < 0) throw new AppError('INSUFFICIENT_STOCK', 'This adjustment would make stock negative');
    const after = recordMovement(ctx, { productId: a.productId, type: a.type, qtyDelta: delta, reason: a.reason, refType: 'adjustment' });
    audit(ctx, { action: 'inventory.adjust', entity: 'products', entityId: a.productId, details: { type: a.type, delta, from: cur.stock_qty, to: after, reason: a.reason } });
    return { stockQty: after };
  });
}

/** Set verified opening balances. Creates an 'opening' movement for the difference. */
export function setOpeningBalances(ctx: Ctx, rows: { productId: number; qty: number }[]): { updated: number } {
  return tx(ctx.db, () => {
    let n = 0;
    for (const r of rows) {
      if (!Number.isInteger(r.qty) || r.qty < 0) throw new AppError('VALIDATION', 'Opening quantities must be whole numbers, zero or more');
      const cur = ctx.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(r.productId) as { stock_qty: number } | undefined;
      if (!cur) throw new AppError('NOT_FOUND', `Product ${r.productId} not found`);
      const delta = r.qty - cur.stock_qty;
      const hasMovements = ctx.db.prepare('SELECT 1 FROM inventory_movements WHERE product_id = ? LIMIT 1').get(r.productId);
      if (delta === 0 && hasMovements) continue;
      // A zero opening balance still records the owner's explicit "verified 0" entry.
      recordMovement(ctx, { productId: r.productId, type: 'opening', qtyDelta: delta, reason: 'Opening balance entered', refType: 'opening' });
      n++;
    }
    if (n) audit(ctx, { action: 'inventory.opening', entity: 'products', details: { count: n } });
    return { updated: n };
  });
}

export interface StockCsvPreviewRow {
  line: number;
  sku: string;
  nameEn: string | null;
  productId: number | null;
  currentQty: number | null;
  newQty: number | null;
  status: 'ok' | 'error';
  issues: string[];
}

export function previewStockCsv(db: Db, text: string): StockCsvPreviewRow[] {
  const { records, headers } = csvToObjects(parseCsv(text));
  if (!headers.includes('sku') || !(headers.includes('qty') || headers.includes('stock'))) {
    throw new AppError('VALIDATION', 'The file needs the columns: sku, qty');
  }
  const seen = new Set<string>();
  return records.map((r, i) => {
    const sku = r.sku ?? '';
    const raw = r.qty ?? r.stock ?? '';
    const issues: string[] = [];
    const p = db.prepare('SELECT id, name_en, stock_qty FROM products WHERE sku = ? COLLATE NOCASE').get(sku) as { id: number; name_en: string; stock_qty: number } | undefined;
    if (!p) issues.push('Unknown SKU');
    if (seen.has(sku.toLowerCase())) issues.push('Duplicate SKU in file');
    seen.add(sku.toLowerCase());
    const q = /^\d+$/.test(raw) ? Number(raw) : null;
    if (q === null) issues.push('Quantity must be a whole number, zero or more');
    return { line: i + 2, sku, nameEn: p?.name_en ?? null, productId: p?.id ?? null, currentQty: p?.stock_qty ?? null, newQty: q, status: issues.length ? 'error' : 'ok', issues };
  });
}

export interface MovementRow {
  id: number;
  productId: number;
  sku: string;
  nameEn: string;
  nameTa: string;
  type: MovementType;
  qtyDelta: number;
  qtyAfter: number;
  reason: string;
  refType: string | null;
  refId: number | null;
  businessDate: string;
  createdAt: string;
  user: string;
}

export function listMovements(db: Db, f: { productId?: number; from?: string; to?: string; type?: string; limit?: number; offset?: number }): { rows: MovementRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.productId) {
    where.push('m.product_id = ?');
    params.push(f.productId);
  }
  if (f.from) {
    where.push('m.business_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('m.business_date <= ?');
    params.push(f.to);
  }
  if (f.type) {
    where.push('m.movement_type = ?');
    params.push(f.type);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) c FROM inventory_movements m ${w}`).get(...params) as { c: number }).c;
  const rows = (
    db
      .prepare(`SELECT m.id, m.product_id, p.sku, p.name_en, p.name_ta, m.movement_type, m.qty_delta, m.qty_after, m.reason, m.ref_type, m.ref_id, m.business_date, m.created_at, u.username FROM inventory_movements m JOIN products p ON p.id = m.product_id JOIN users u ON u.id = m.created_by ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`)
      .all(...params, f.limit ?? 200, f.offset ?? 0) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as number,
    productId: r.product_id as number,
    sku: r.sku as string,
    nameEn: r.name_en as string,
    nameTa: r.name_ta as string,
    type: r.movement_type as MovementType,
    qtyDelta: r.qty_delta as number,
    qtyAfter: r.qty_after as number,
    reason: r.reason as string,
    refType: r.ref_type as string | null,
    refId: r.ref_id as number | null,
    businessDate: r.business_date as string,
    createdAt: r.created_at as string,
    user: r.username as string,
  }));
  return { rows, total };
}

export interface ValuationRow {
  productId: number;
  sku: string;
  nameEn: string;
  nameTa: string;
  categoryName: string;
  stockQty: number;
  costPaise: number | null;
  valuePaise: number | null;
}

/** Stock valuation at purchase cost. Products without a cost are listed but excluded from the total. */
export function stockValuation(db: Db): { rows: ValuationRow[]; totalPaise: number; productsWithoutCost: number } {
  const rows = (
    db
      .prepare('SELECT p.id, p.sku, p.name_en, p.name_ta, c.name_en AS cat, p.stock_qty, p.cost_paise FROM products p JOIN categories c ON c.id = p.category_id WHERE p.active = 1 ORDER BY p.sort_order, p.id')
      .all() as { id: number; sku: string; name_en: string; name_ta: string; cat: string; stock_qty: number; cost_paise: number | null }[]
  ).map((r) => ({ productId: r.id, sku: r.sku, nameEn: r.name_en, nameTa: r.name_ta, categoryName: r.cat, stockQty: r.stock_qty, costPaise: r.cost_paise, valuePaise: r.cost_paise === null ? null : r.cost_paise * Math.max(r.stock_qty, 0) }));
  return {
    rows,
    totalPaise: rows.reduce((s, r) => s + (r.valuePaise ?? 0), 0),
    productsWithoutCost: rows.filter((r) => r.costPaise === null && r.stockQty > 0).length,
  };
}

export interface ReconcileRow {
  productId: number;
  sku: string;
  nameEn: string;
  nameTa: string;
  openingQty: number;
  purchased: number;
  sold: number;
  returned: number;
  adjusted: number;
  expectedClosing: number;
  systemClosing: number;
  /** Physical count if supplied (not persisted here). */
  variance: number;
}

/** Daily stock reconciliation from the movement ledger: opening + movements = closing, cross-checked with the cached stock. */
export function reconcileDay(db: Db, date: string): ReconcileRow[] {
  if (!isDateString(date)) throw new AppError('VALIDATION', 'Invalid date');
  const prods = db.prepare('SELECT id, sku, name_en, name_ta, stock_qty FROM products WHERE active = 1 ORDER BY sort_order, id').all() as { id: number; sku: string; name_en: string; name_ta: string; stock_qty: number }[];
  const beforeQ = db.prepare('SELECT qty_after FROM inventory_movements WHERE product_id = ? AND business_date < ? ORDER BY id DESC LIMIT 1');
  const dayQ = db.prepare('SELECT movement_type, SUM(qty_delta) s FROM inventory_movements WHERE product_id = ? AND business_date = ? GROUP BY movement_type');
  const afterQ = db.prepare('SELECT qty_after FROM inventory_movements WHERE product_id = ? AND business_date <= ? ORDER BY id DESC LIMIT 1');
  return prods.map((p) => {
    const opening = (beforeQ.get(p.id, date) as { qty_after: number } | undefined)?.qty_after ?? 0;
    let purchased = 0,
      sold = 0,
      returned = 0,
      adjusted = 0;
    for (const r of dayQ.all(p.id, date) as { movement_type: MovementType; s: number }[]) {
      if (r.movement_type === 'purchase') purchased += r.s;
      else if (r.movement_type === 'sale') sold += r.s;
      else if (r.movement_type === 'sale_cancel' || r.movement_type === 'return_restock') returned += r.s;
      else adjusted += r.s;
    }
    const expected = opening + purchased + sold + returned + adjusted;
    const sysClose = (afterQ.get(p.id, date) as { qty_after: number } | undefined)?.qty_after ?? 0;
    return { productId: p.id, sku: p.sku, nameEn: p.name_en, nameTa: p.name_ta, openingQty: opening, purchased, sold, returned, adjusted, expectedClosing: expected, systemClosing: sysClose, variance: sysClose - expected };
  });
}

/** Record a physical stock count: every difference becomes a 'count_correction' movement. */
export function recordStockCount(ctx: Ctx, input: { date: string; counts: { productId: number; countedQty: number }[] }): { corrected: number } {
  const date = z.string().refine(isDateString).parse(input.date);
  return tx(ctx.db, () => {
    let n = 0;
    for (const c of input.counts) {
      if (!Number.isInteger(c.countedQty) || c.countedQty < 0) throw new AppError('VALIDATION', 'Counted quantities must be whole numbers, zero or more');
      const cur = ctx.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(c.productId) as { stock_qty: number } | undefined;
      if (!cur) throw new AppError('NOT_FOUND', 'Product not found');
      const delta = c.countedQty - cur.stock_qty;
      if (delta === 0) continue;
      recordMovement(ctx, { productId: c.productId, type: 'count_correction', qtyDelta: delta, reason: `Physical stock count ${date}`, refType: 'count' });
      audit(ctx, { action: 'inventory.count_correction', entity: 'products', entityId: c.productId, details: { date, from: cur.stock_qty, to: c.countedQty } });
      n++;
    }
    return { corrected: n };
  });
}

export function lowStock(db: Db, limit = 100): { id: number; sku: string; nameEn: string; nameTa: string; stockQty: number; minStock: number; unit: string }[] {
  return (db.prepare('SELECT id, sku, name_en, name_ta, stock_qty, min_stock, unit FROM products WHERE active = 1 AND stock_qty <= min_stock ORDER BY stock_qty, sort_order LIMIT ?').all(limit) as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    sku: r.sku as string,
    nameEn: r.name_en as string,
    nameTa: r.name_ta as string,
    stockQty: r.stock_qty as number,
    minStock: r.min_stock as number,
    unit: r.unit as string,
  }));
}

export { istRangeToUtc };
