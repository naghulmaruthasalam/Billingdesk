import { z } from 'zod';
import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { businessDate, isDateString, isoNow } from './time';
import { formatNumber, nextCounter } from './counters';
import { recordMovement } from './inventory';

export interface SupplierDTO {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
}

export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().default(true),
});

export function listSuppliers(db: Db): SupplierDTO[] {
  return (db.prepare('SELECT id, name, phone, address, notes, active FROM suppliers ORDER BY name').all() as { id: number; name: string; phone: string | null; address: string | null; notes: string | null; active: number }[]).map((r) => ({ ...r, active: r.active === 1 }));
}

export function saveSupplier(ctx: Ctx, id: number | null, input: z.input<typeof supplierSchema>): SupplierDTO[] {
  const s = supplierSchema.parse(input);
  tx(ctx.db, () => {
    const ts = isoNow(ctx.now());
    try {
      if (id) {
        const info = ctx.db.prepare('UPDATE suppliers SET name=?, phone=?, address=?, notes=?, active=?, updated_at=? WHERE id=?').run(s.name, s.phone ?? null, s.address ?? null, s.notes ?? null, s.active ? 1 : 0, ts, id);
        if (!info.changes) throw new AppError('NOT_FOUND', 'Supplier not found');
        audit(ctx, { action: 'supplier.update', entity: 'suppliers', entityId: id });
      } else {
        const nid = ctx.db.prepare('INSERT INTO suppliers (name, phone, address, notes, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').run(s.name, s.phone ?? null, s.address ?? null, s.notes ?? null, s.active ? 1 : 0, ts, ts).lastInsertRowid;
        audit(ctx, { action: 'supplier.create', entity: 'suppliers', entityId: Number(nid) });
      }
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) throw new AppError('CONFLICT', 'A supplier with this name already exists');
      throw e;
    }
  });
  return listSuppliers(ctx.db);
}

export const purchaseSchema = z.object({
  supplierId: z.number().int().positive().nullable().optional(),
  supplierInvoiceNo: z.string().trim().max(60).nullable().optional(),
  purchaseDate: z.string().refine(isDateString, 'Invalid date'),
  notes: z.string().trim().max(300).nullable().optional(),
  /** Update each product's stored purchase cost to this purchase's unit cost. */
  updateCost: z.boolean().default(true),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().int().positive('Quantity must be at least 1'),
        unitCostPaise: z.number().int().min(0).nullable(),
      }),
    )
    .min(1, 'Add at least one product'),
});

export interface PurchaseSummary {
  id: number;
  purchaseNo: string;
  supplierName: string | null;
  supplierInvoiceNo: string | null;
  purchaseDate: string;
  totalPaise: number;
  lineCount: number;
  createdBy: string;
}

export function createPurchase(ctx: Ctx, input: z.input<typeof purchaseSchema>): PurchaseSummary {
  const p = purchaseSchema.parse(input);
  return tx(ctx.db, () => {
    if (p.supplierId && !ctx.db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(p.supplierId)) throw new AppError('NOT_FOUND', 'Supplier not found');
    const total = p.lines.reduce((s, l) => s + l.qty * (l.unitCostPaise ?? 0), 0);
    const no = formatNumber('PUR', nextCounter(ctx.db, 'purchase'), 5);
    const id = Number(
      ctx.db
        .prepare('INSERT INTO purchases (purchase_no, supplier_id, supplier_invoice_no, purchase_date, total_paise, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(no, p.supplierId ?? null, p.supplierInvoiceNo ?? null, p.purchaseDate, total, p.notes ?? null, ctx.user.id, isoNow(ctx.now())).lastInsertRowid,
    );
    for (const l of p.lines) {
      const prod = ctx.db.prepare('SELECT cost_paise FROM products WHERE id = ?').get(l.productId) as { cost_paise: number | null } | undefined;
      if (!prod) throw new AppError('NOT_FOUND', `Product ${l.productId} not found`);
      ctx.db.prepare('INSERT INTO purchase_lines (purchase_id, product_id, qty, unit_cost_paise) VALUES (?,?,?,?)').run(id, l.productId, l.qty, l.unitCostPaise);
      recordMovement(ctx, { productId: l.productId, type: 'purchase', qtyDelta: l.qty, reason: `Purchase ${no}`, refType: 'purchase', refId: id });
      if (p.updateCost && l.unitCostPaise !== null && l.unitCostPaise !== prod.cost_paise) {
        ctx.db.prepare('UPDATE products SET cost_paise = ?, updated_at = ? WHERE id = ?').run(l.unitCostPaise, isoNow(ctx.now()), l.productId);
        audit(ctx, { action: 'product.cost_change', entity: 'products', entityId: l.productId, details: { from: prod.cost_paise, to: l.unitCostPaise, purchase: no } });
      }
    }
    audit(ctx, { action: 'purchase.create', entity: 'purchases', entityId: id, details: { purchaseNo: no, totalPaise: total, lines: p.lines.length } });
    return listPurchases(ctx.db, { limit: 1, id }).rows[0];
  });
}

export function listPurchases(db: Db, f: { from?: string; to?: string; supplierId?: number; limit?: number; offset?: number; id?: number }): { rows: PurchaseSummary[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.id) {
    where.push('p.id = ?');
    params.push(f.id);
  }
  if (f.from) {
    where.push('p.purchase_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('p.purchase_date <= ?');
    params.push(f.to);
  }
  if (f.supplierId) {
    where.push('p.supplier_id = ?');
    params.push(f.supplierId);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) c FROM purchases p ${w}`).get(...params) as { c: number }).c;
  const rows = (
    db
      .prepare(`SELECT p.id, p.purchase_no, s.name AS supplier, p.supplier_invoice_no, p.purchase_date, p.total_paise, (SELECT COUNT(*) FROM purchase_lines l WHERE l.purchase_id = p.id) AS n, u.username FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = p.created_by ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`)
      .all(...params, f.limit ?? 100, f.offset ?? 0) as Record<string, unknown>[]
  ).map((r) => ({ id: r.id as number, purchaseNo: r.purchase_no as string, supplierName: r.supplier as string | null, supplierInvoiceNo: r.supplier_invoice_no as string | null, purchaseDate: r.purchase_date as string, totalPaise: r.total_paise as number, lineCount: r.n as number, createdBy: r.username as string }));
  return { rows, total };
}

export function getPurchase(db: Db, id: number): PurchaseSummary & { lines: { productId: number; sku: string; nameEn: string; nameTa: string; qty: number; unitCostPaise: number | null }[] } {
  const s = listPurchases(db, { id, limit: 1 }).rows[0];
  if (!s) throw new AppError('NOT_FOUND', 'Purchase not found');
  const lines = (db.prepare('SELECT l.product_id, p.sku, p.name_en, p.name_ta, l.qty, l.unit_cost_paise FROM purchase_lines l JOIN products p ON p.id = l.product_id WHERE l.purchase_id = ? ORDER BY l.id').all(id) as Record<string, unknown>[]).map((r) => ({
    productId: r.product_id as number,
    sku: r.sku as string,
    nameEn: r.name_en as string,
    nameTa: r.name_ta as string,
    qty: r.qty as number,
    unitCostPaise: r.unit_cost_paise as number | null,
  }));
  return { ...s, lines };
}

export const todayBusinessDate = (now: Date): string => businessDate(now);
