import { z } from 'zod';
import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { businessDate, isoNow, isDateString } from './time';
import { getSetting } from './settings';
import { formatNumber, nextCounter } from './counters';
import { requireOrApproval, requirePermission } from './authz';
import { recordMovement } from './inventory';
import { computeTotals, resolveDiscountBp, settlePayments, type DiscountRule, type PaymentMode } from '../shared/pricing';

export const approvalSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export const paymentInputSchema = z.object({
  mode: z.enum(['cash', 'upi', 'card']),
  amountPaise: z.number().int().positive(),
  reference: z.string().trim().max(60).nullable().optional(),
});

export const createInvoiceSchema = z.object({
  /** Idempotency key generated once per bill by the UI. Repeating the request returns the original invoice. */
  clientRequestId: z.string().min(8).max(64),
  customer: z
    .object({
      id: z.number().int().positive().nullable().optional(),
      name: z.string().trim().max(120).nullable().optional(),
      phone: z.string().trim().max(20).nullable().optional(),
    })
    .nullable()
    .optional(),
  lines: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qty: z.number().int().positive('Quantity must be a whole number of at least 1').max(100000),
        /** Replaces (never adds to) the policy discount for this line. */
        discountOverrideBp: z.number().int().min(0).max(10000).nullable().optional(),
        overrideReason: z.string().trim().max(200).nullable().optional(),
        stockOverride: z.boolean().optional(),
      }),
    )
    .min(1, 'The bill has no items')
    .max(200),
  payments: z.array(paymentInputSchema).max(6),
  notes: z.string().trim().max(300).nullable().optional(),
  approval: approvalSchema.nullable().optional(),
});
export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

export interface InvoiceLineDTO {
  id: number;
  lineNo: number;
  productId: number;
  sku: string;
  nameEn: string;
  nameTa: string;
  unit: string;
  qty: number;
  ratePaise: number;
  grossPaise: number;
  discountBp: number;
  discountPaise: number;
  netPaise: number;
  discountSource: 'none' | 'policy' | 'override';
  overrideReason: string | null;
  stockOverride: boolean;
  returnedQty: number;
}

export interface PaymentDTO {
  id: number;
  kind: 'sale' | 'due' | 'refund';
  mode: PaymentMode | 'credit_note';
  amountPaise: number;
  tenderedPaise: number | null;
  reference: string | null;
  createdAt: string;
}

export interface InvoiceDTO {
  id: number;
  invoiceNo: string;
  status: 'completed' | 'cancelled';
  businessDate: string;
  createdAt: string;
  cashier: string;
  cashierName: string;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  subtotalPaise: number;
  discountPaise: number;
  discountRoundingPaise: number;
  taxPaise: number;
  totalPaise: number;
  taxEnabled: boolean;
  taxRateBp: number;
  taxInclusive: boolean;
  roundingScope: string;
  roundingUnit: string;
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  paidPaise: number;
  duePaise: number;
  changePaise: number;
  refundedPaise: number;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  lines: InvoiceLineDTO[];
  payments: PaymentDTO[];
  /** True when the request repeated an earlier clientRequestId. */
  duplicate?: boolean;
}

interface InvoiceRow {
  id: number;
  invoice_no: string;
  status: 'completed' | 'cancelled';
  business_date: string;
  created_at: string;
  username: string;
  display_name: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal_paise: number;
  discount_paise: number;
  discount_rounding_paise: number;
  tax_paise: number;
  total_paise: number;
  tax_enabled: number;
  tax_rate_bp: number;
  tax_inclusive: number;
  rounding_scope: string;
  rounding_unit: string;
  payment_status: 'paid' | 'partial' | 'unpaid';
  notes: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export function getInvoice(db: Db, id: number): InvoiceDTO {
  const r = db
    .prepare('SELECT i.*, u.username, u.display_name FROM invoices i JOIN users u ON u.id = i.cashier_id WHERE i.id = ?')
    .get(id) as InvoiceRow | undefined;
  if (!r) throw new AppError('NOT_FOUND', 'Invoice not found');
  const lines = (
    db
      .prepare(
        `SELECT l.*, COALESCE((SELECT SUM(rl.qty) FROM return_lines rl WHERE rl.invoice_line_id = l.id), 0) AS returned_qty FROM invoice_lines l WHERE l.invoice_id = ? ORDER BY l.line_no`,
      )
      .all(id) as Record<string, unknown>[]
  ).map(
    (l): InvoiceLineDTO => ({
      id: l.id as number,
      lineNo: l.line_no as number,
      productId: l.product_id as number,
      sku: l.sku as string,
      nameEn: l.name_en as string,
      nameTa: l.name_ta as string,
      unit: l.unit as string,
      qty: l.qty as number,
      ratePaise: l.rate_paise as number,
      grossPaise: l.gross_paise as number,
      discountBp: l.discount_bp as number,
      discountPaise: l.discount_paise as number,
      netPaise: l.net_paise as number,
      discountSource: l.discount_source as InvoiceLineDTO['discountSource'],
      overrideReason: l.override_reason as string | null,
      stockOverride: l.stock_override === 1,
      returnedQty: l.returned_qty as number,
    }),
  );
  const payments = (db.prepare('SELECT id, kind, mode, amount_paise, tendered_paise, reference, created_at FROM payments WHERE invoice_id = ? ORDER BY id').all(id) as Record<string, unknown>[]).map(
    (p): PaymentDTO => ({ id: p.id as number, kind: p.kind as PaymentDTO['kind'], mode: p.mode as PaymentDTO['mode'], amountPaise: p.amount_paise as number, tenderedPaise: p.tendered_paise as number | null, reference: p.reference as string | null, createdAt: p.created_at as string }),
  );
  const paid = payments.filter((p) => p.kind !== 'refund').reduce((s, p) => s + p.amountPaise, 0);
  const refunded = payments.filter((p) => p.kind === 'refund').reduce((s, p) => s + p.amountPaise, 0);
  const change = payments.filter((p) => p.kind !== 'refund' && p.mode === 'cash').reduce((s, p) => s + Math.max((p.tenderedPaise ?? p.amountPaise) - p.amountPaise, 0), 0);
  return {
    id: r.id,
    invoiceNo: r.invoice_no,
    status: r.status,
    businessDate: r.business_date,
    createdAt: r.created_at,
    cashier: r.username,
    cashierName: r.display_name,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    subtotalPaise: r.subtotal_paise,
    discountPaise: r.discount_paise,
    discountRoundingPaise: r.discount_rounding_paise,
    taxPaise: r.tax_paise,
    totalPaise: r.total_paise,
    taxEnabled: r.tax_enabled === 1,
    taxRateBp: r.tax_rate_bp,
    taxInclusive: r.tax_inclusive === 1,
    roundingScope: r.rounding_scope,
    roundingUnit: r.rounding_unit,
    paymentStatus: r.payment_status,
    paidPaise: paid,
    duePaise: Math.max(r.total_paise - paid, 0),
    changePaise: change,
    refundedPaise: refunded,
    notes: r.notes,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    lines,
    payments,
  };
}

export function createInvoice(ctx: Ctx, input: CreateInvoiceInput): InvoiceDTO {
  const inp = createInvoiceSchema.parse(input);
  return tx(ctx.db, () => {
    requirePermission(ctx, 'billing.create');
    const dup = ctx.db.prepare('SELECT id FROM invoices WHERE client_request_id = ?').get(inp.clientRequestId) as { id: number } | undefined;
    if (dup) return { ...getInvoice(ctx.db, dup.id), duplicate: true };

    if (!getSetting(ctx.db, 'setup.catalogue_approved')) {
      throw new AppError('SETUP_INCOMPLETE', 'The product catalogue has not been approved yet. The owner must review and approve it (Products > Catalogue review) before billing starts.');
    }

    const defaultBp = getSetting(ctx.db, 'discount.default_bp');
    const scope = getSetting(ctx.db, 'discount.rounding_scope');
    const unit = getSetting(ctx.db, 'discount.rounding_unit');
    const tax = { enabled: getSetting(ctx.db, 'tax.enabled'), rateBp: getSetting(ctx.db, 'tax.rate_bp'), inclusive: getSetting(ctx.db, 'tax.inclusive') };
    const enforcement = getSetting(ctx.db, 'billing.stock_enforcement');
    const allowCredit = getSetting(ctx.db, 'billing.allow_credit');

    let approver: { id: number; username: string } | null = null;
    const ensureApprover = (perm: 'billing.discount_override' | 'billing.stock_override') => {
      if (ctx.user.permissions.includes(perm)) return;
      approver ??= requireOrApproval(ctx, perm, inp.approval);
    };

    interface Resolved {
      p: { id: number; sku: string; name_en: string; name_ta: string; unit: string; price_paise: number | null; cost_paise: number | null; stock_qty: number; active: number; discount_rule: DiscountRule; cat_rule: DiscountRule; cat_bp: number | null };
      qty: number;
      bp: number;
      source: 'none' | 'policy' | 'override';
      reason: string | null;
      stockOverride: boolean;
    }
    const resolved: Resolved[] = inp.lines.map((l) => {
      const p = ctx.db
        .prepare('SELECT p.id, p.sku, p.name_en, p.name_ta, p.unit, p.price_paise, p.cost_paise, p.stock_qty, p.active, p.discount_rule, c.discount_rule AS cat_rule, c.discount_bp AS cat_bp FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?')
        .get(l.productId) as Resolved['p'] | undefined;
      if (!p) throw new AppError('NOT_FOUND', `Product ${l.productId} not found`);
      if (!p.active) throw new AppError('VALIDATION', `${p.name_en} is inactive and cannot be sold`);
      if (p.price_paise === null) throw new AppError('VALIDATION', `${p.name_en} has no price. Set a price before selling it.`);
      const policyBp = resolveDiscountBp({ productRule: p.discount_rule, categoryRule: p.cat_rule, categoryBp: p.cat_bp, defaultBp });
      let bp = policyBp;
      let source: Resolved['source'] = policyBp > 0 ? 'policy' : 'none';
      let reason: string | null = null;
      if (l.discountOverrideBp !== undefined && l.discountOverrideBp !== null && l.discountOverrideBp !== policyBp) {
        ensureApprover('billing.discount_override');
        if (!l.overrideReason || l.overrideReason.length < 3) throw new AppError('VALIDATION', `Give a reason for changing the discount on ${p.name_en}`);
        bp = l.discountOverrideBp;
        source = 'override';
        reason = l.overrideReason;
      }
      return { p, qty: l.qty, bp, source, reason, stockOverride: false };
    });

    // Stock check on aggregated quantities per product.
    const wanted = new Map<number, number>();
    resolved.forEach((r) => wanted.set(r.p.id, (wanted.get(r.p.id) ?? 0) + r.qty));
    const short: { productId: number; name: string; available: number; requested: number }[] = [];
    for (const [pid, qty] of wanted) {
      const r = resolved.find((x) => x.p.id === pid)!;
      if (qty > r.p.stock_qty) short.push({ productId: pid, name: r.p.name_en, available: r.p.stock_qty, requested: qty });
    }
    if (short.length) {
      if (enforcement === 'enforce') {
        const asked = inp.lines.filter((l) => l.stockOverride).map((l) => l.productId);
        const unresolved = short.filter((s) => !asked.includes(s.productId));
        if (unresolved.length) {
          throw new AppError('INSUFFICIENT_STOCK', `Not enough stock: ${unresolved.map((s) => `${s.name} (have ${s.available}, need ${s.requested})`).join('; ')}`, { items: unresolved });
        }
        ensureApprover('billing.stock_override');
      }
      for (const r of resolved) if (short.some((s) => s.productId === r.p.id)) r.stockOverride = true;
    }

    const totals = computeTotals(
      resolved.map((r) => ({ qty: r.qty, ratePaise: r.p.price_paise!, discountBp: r.bp })),
      { roundingScope: scope, roundingUnit: unit },
      tax,
    );
    const settlement = settlePayments(totals.totalPaise, inp.payments, allowCredit);
    if (totals.totalPaise === 0 && inp.payments.length === 0) {
      /* zero-value bill: nothing to settle */
    }

    // Customer: link or create by phone.
    let customerId: number | null = inp.customer?.id ?? null;
    let customerName = inp.customer?.name || null;
    let customerPhone = inp.customer?.phone || null;
    const nowD = ctx.now();
    const ts = isoNow(nowD);
    if (customerId) {
      const c = ctx.db.prepare('SELECT name, phone FROM customers WHERE id = ?').get(customerId) as { name: string; phone: string | null } | undefined;
      if (!c) throw new AppError('NOT_FOUND', 'Customer not found');
      customerName ??= c.name;
      customerPhone ??= c.phone;
    } else if (customerName || customerPhone) {
      const existing = customerPhone ? (ctx.db.prepare('SELECT id, name FROM customers WHERE phone = ? ORDER BY id LIMIT 1').get(customerPhone) as { id: number; name: string } | undefined) : undefined;
      if (existing) {
        customerId = existing.id;
        customerName ??= existing.name;
      } else if (customerName) {
        customerId = Number(ctx.db.prepare('INSERT INTO customers (name, phone, created_at, updated_at) VALUES (?,?,?,?)').run(customerName, customerPhone, ts, ts).lastInsertRowid);
      }
    }

    const seq = nextCounter(ctx.db, 'invoice');
    const invoiceNo = formatNumber(getSetting(ctx.db, 'invoice.prefix'), seq, getSetting(ctx.db, 'invoice.pad'));
    const invId = Number(
      ctx.db
        .prepare(
          `INSERT INTO invoices (invoice_no, seq, client_request_id, status, business_date, created_at, cashier_id, customer_id, customer_name, customer_phone,
             subtotal_paise, discount_paise, discount_rounding_paise, tax_paise, total_paise, tax_enabled, tax_rate_bp, tax_inclusive, rounding_scope, rounding_unit, payment_status, notes, approved_by)
           VALUES (?,?,?,'completed',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(invoiceNo, seq, inp.clientRequestId, businessDate(nowD), ts, ctx.user.id, customerId, customerName, customerPhone, totals.subtotalPaise, totals.discountPaise, totals.discountRoundingPaise, totals.taxPaise, totals.totalPaise, tax.enabled ? 1 : 0, tax.rateBp, tax.inclusive ? 1 : 0, scope, unit, settlement.status, inp.notes ?? null, (approver as { id: number } | null)?.id ?? null)
        .lastInsertRowid,
    );

    const insLine = ctx.db.prepare(
      'INSERT INTO invoice_lines (invoice_id, line_no, product_id, sku, name_en, name_ta, unit, qty, rate_paise, gross_paise, discount_bp, discount_paise, net_paise, discount_source, override_reason, stock_override, cost_paise) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    resolved.forEach((r, i) => {
      const t = totals.lines[i];
      insLine.run(invId, i + 1, r.p.id, r.p.sku, r.p.name_en, r.p.name_ta, r.p.unit, r.qty, r.p.price_paise, t.grossPaise, r.bp, t.discountPaise, t.netPaise, r.source, r.reason, r.stockOverride ? 1 : 0, r.p.cost_paise);
      recordMovement(ctx, { productId: r.p.id, type: 'sale', qtyDelta: -r.qty, reason: `Sale ${invoiceNo}`, refType: 'invoice', refId: invId });
      if (r.source === 'override') {
        audit({ ...ctx, approver }, { action: 'billing.discount_override', entity: 'invoices', entityId: invId, details: { invoiceNo, productId: r.p.id, sku: r.p.sku, policyPercentBp: resolveDiscountBp({ productRule: r.p.discount_rule, categoryRule: r.p.cat_rule, categoryBp: r.p.cat_bp, defaultBp }), appliedBp: r.bp, reason: r.reason } });
      }
      if (r.stockOverride) {
        audit({ ...ctx, approver }, { action: 'billing.stock_override', entity: 'invoices', entityId: invId, details: { invoiceNo, productId: r.p.id, sku: r.p.sku, qty: r.qty, stockBefore: r.p.stock_qty } });
      }
    });
    const insPay = ctx.db.prepare('INSERT INTO payments (invoice_id, kind, mode, amount_paise, tendered_paise, reference, business_date, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const p of settlement.payments) insPay.run(invId, 'sale', p.mode, p.amountPaise, p.tenderedPaise, p.reference, businessDate(nowD), ts, ctx.user.id);
    return getInvoice(ctx.db, invId);
  });
}

// ---------------------------------------------------------------- history

export interface InvoiceFilter {
  from?: string;
  to?: string;
  invoiceNo?: string;
  productId?: number;
  cashierId?: number;
  paymentMode?: string;
  customer?: string;
  status?: 'completed' | 'cancelled';
  limit?: number;
  offset?: number;
}

export interface InvoiceSummary {
  id: number;
  invoiceNo: string;
  createdAt: string;
  businessDate: string;
  cashier: string;
  customerName: string | null;
  customerPhone: string | null;
  totalPaise: number;
  discountPaise: number;
  status: 'completed' | 'cancelled';
  paymentStatus: 'paid' | 'partial' | 'unpaid';
  modes: string;
  returnedPaise: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function listInvoices(db: Db, f: InvoiceFilter): { rows: InvoiceSummary[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) {
    where.push('i.business_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('i.business_date <= ?');
    params.push(f.to);
  }
  if (f.invoiceNo) {
    where.push("i.invoice_no LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(f.invoiceNo)}%`);
  }
  if (f.productId) {
    where.push('EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = i.id AND l.product_id = ?)');
    params.push(f.productId);
  }
  if (f.cashierId) {
    where.push('i.cashier_id = ?');
    params.push(f.cashierId);
  }
  if (f.paymentMode) {
    where.push("EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND p.kind <> 'refund' AND p.mode = ?)");
    params.push(f.paymentMode);
  }
  if (f.customer) {
    where.push("(i.customer_name LIKE ? ESCAPE '\\' OR i.customer_phone LIKE ? ESCAPE '\\')");
    params.push(`%${escapeLike(f.customer)}%`, `%${escapeLike(f.customer)}%`);
  }
  if (f.status) {
    where.push('i.status = ?');
    params.push(f.status);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) c FROM invoices i ${w}`).get(...params) as { c: number }).c;
  const rows = (
    db
      .prepare(
        `SELECT i.id, i.invoice_no, i.created_at, i.business_date, u.username, i.customer_name, i.customer_phone, i.total_paise, i.discount_paise, i.status, i.payment_status,
           (SELECT GROUP_CONCAT(DISTINCT p.mode) FROM payments p WHERE p.invoice_id = i.id AND p.kind <> 'refund') AS modes,
           COALESCE((SELECT SUM(r.refund_paise) FROM returns r WHERE r.invoice_id = i.id), 0) AS returned
         FROM invoices i JOIN users u ON u.id = i.cashier_id ${w} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, f.limit ?? 100, f.offset ?? 0) as Record<string, unknown>[]
  ).map(
    (r): InvoiceSummary => ({
      id: r.id as number,
      invoiceNo: r.invoice_no as string,
      createdAt: r.created_at as string,
      businessDate: r.business_date as string,
      cashier: r.username as string,
      customerName: r.customer_name as string | null,
      customerPhone: r.customer_phone as string | null,
      totalPaise: r.total_paise as number,
      discountPaise: r.discount_paise as number,
      status: r.status as 'completed' | 'cancelled',
      paymentStatus: r.payment_status as InvoiceSummary['paymentStatus'],
      modes: (r.modes as string | null) ?? '',
      returnedPaise: r.returned as number,
    }),
  );
  return { rows, total };
}

export function findInvoiceByNo(db: Db, invoiceNo: string): InvoiceDTO {
  const r = db.prepare('SELECT id FROM invoices WHERE invoice_no = ? COLLATE NOCASE').get(invoiceNo.trim()) as { id: number } | undefined;
  if (!r) throw new AppError('NOT_FOUND', 'Invoice not found');
  return getInvoice(db, r.id);
}

// ------------------------------------------------------------ cancellation

export const cancelSchema = z.object({
  invoiceId: z.number().int().positive(),
  reason: z.string().trim().min(3, 'Please give a reason for cancelling this bill').max(300),
  approval: approvalSchema.nullable().optional(),
});

/**
 * Void a completed bill: stock is restored through inventory movements and every payment is reversed with an
 * offsetting refund row. The invoice itself is never edited or deleted - it is only marked cancelled.
 */
export function cancelInvoice(ctx: Ctx, input: z.input<typeof cancelSchema>): InvoiceDTO {
  const c = cancelSchema.parse(input);
  return tx(ctx.db, () => {
    const approver = requireOrApproval(ctx, 'sales.cancel', c.approval);
    const inv = getInvoice(ctx.db, c.invoiceId);
    if (inv.status === 'cancelled') throw new AppError('CONFLICT', 'This bill is already cancelled');
    const hasReturns = ctx.db.prepare('SELECT 1 FROM returns WHERE invoice_id = ? LIMIT 1').get(inv.id);
    if (hasReturns) throw new AppError('CONFLICT', 'This bill already has returns recorded. It can no longer be cancelled.');
    const now = ctx.now();
    const ts = isoNow(now);
    for (const l of inv.lines) {
      recordMovement(ctx, { productId: l.productId, type: 'sale_cancel', qtyDelta: l.qty, reason: `Cancelled ${inv.invoiceNo}: ${c.reason}`, refType: 'invoice', refId: inv.id });
    }
    const ins = ctx.db.prepare("INSERT INTO payments (invoice_id, kind, mode, amount_paise, tendered_paise, reference, business_date, created_at, created_by) VALUES (?,'refund',?,?,NULL,?,?,?,?)");
    for (const p of inv.payments.filter((x) => x.kind !== 'refund')) ins.run(inv.id, p.mode, p.amountPaise, `Cancellation of ${inv.invoiceNo}`, businessDate(now), ts, ctx.user.id);
    ctx.db.prepare("UPDATE invoices SET status='cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=? WHERE id=?").run(ts, ctx.user.id, c.reason, inv.id);
    audit({ ...ctx, approver }, { action: 'invoice.cancel', entity: 'invoices', entityId: inv.id, details: { invoiceNo: inv.invoiceNo, totalPaise: inv.totalPaise, refundedPaise: inv.paidPaise, reason: c.reason } });
    return getInvoice(ctx.db, inv.id);
  });
}

// --------------------------------------------------------------- collect due

export const collectDueSchema = z.object({ invoiceId: z.number().int().positive(), payments: z.array(paymentInputSchema).min(1).max(6) });

export function collectDue(ctx: Ctx, input: z.input<typeof collectDueSchema>): InvoiceDTO {
  const c = collectDueSchema.parse(input);
  return tx(ctx.db, () => {
    requirePermission(ctx, 'sales.collect_due');
    const inv = getInvoice(ctx.db, c.invoiceId);
    if (inv.status !== 'completed') throw new AppError('CONFLICT', 'Only completed bills can receive payment');
    if (inv.duePaise <= 0) throw new AppError('CONFLICT', 'This bill has no pending amount');
    const s = settlePayments(inv.duePaise, c.payments, true);
    const now = ctx.now();
    const ins = ctx.db.prepare("INSERT INTO payments (invoice_id, kind, mode, amount_paise, tendered_paise, reference, business_date, created_at, created_by) VALUES (?,'due',?,?,?,?,?,?,?)");
    for (const p of s.payments) ins.run(inv.id, p.mode, p.amountPaise, p.tenderedPaise, p.reference, businessDate(now), isoNow(now), ctx.user.id);
    ctx.db.prepare('UPDATE invoices SET payment_status = ? WHERE id = ?').run(s.status === 'paid' ? 'paid' : 'partial', inv.id);
    audit(ctx, { action: 'invoice.collect_due', entity: 'invoices', entityId: inv.id, details: { invoiceNo: inv.invoiceNo, paidPaise: s.paidPaise } });
    return getInvoice(ctx.db, inv.id);
  });
}

export { isDateString };
