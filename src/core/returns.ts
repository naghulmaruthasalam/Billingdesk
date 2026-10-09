import { z } from 'zod';
import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { businessDate, isoNow } from './time';
import { formatNumber, nextCounter } from './counters';
import { requireOrApproval } from './authz';
import { recordMovement } from './inventory';
import { roundDiv } from '../shared/money';
import { approvalSchema, getInvoice } from './billing';

export const returnSchema = z.object({
  clientRequestId: z.string().min(8).max(64),
  invoiceId: z.number().int().positive(),
  reason: z.string().trim().min(3, 'Please give a reason for the return').max(300),
  refundMode: z.enum(['cash', 'upi', 'card', 'credit_note']),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.number().int().positive(),
        qty: z.number().int().positive(),
        /** true: goods go back on the shelf. false: goods are damaged/unsellable (no stock increase). */
        restock: z.boolean(),
      }),
    )
    .min(1, 'Select at least one item to return'),
  approval: approvalSchema.nullable().optional(),
});

export interface ReturnDTO {
  id: number;
  returnNo: string;
  invoiceId: number;
  invoiceNo: string;
  createdAt: string;
  businessDate: string;
  reason: string;
  refundMode: string;
  refundPaise: number;
  createdBy: string;
  lines: { invoiceLineId: number; nameEn: string; nameTa: string; qty: number; refundPaise: number; restocked: boolean }[];
}

export function getReturn(db: Db, id: number): ReturnDTO {
  const r = db
    .prepare('SELECT r.*, i.invoice_no, u.username FROM returns r JOIN invoices i ON i.id = r.invoice_id JOIN users u ON u.id = r.created_by WHERE r.id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!r) throw new AppError('NOT_FOUND', 'Return not found');
  const lines = (db.prepare('SELECT rl.invoice_line_id, il.name_en, il.name_ta, rl.qty, rl.refund_paise, rl.restocked FROM return_lines rl JOIN invoice_lines il ON il.id = rl.invoice_line_id WHERE rl.return_id = ? ORDER BY rl.id').all(id) as Record<string, unknown>[]).map((l) => ({
    invoiceLineId: l.invoice_line_id as number,
    nameEn: l.name_en as string,
    nameTa: l.name_ta as string,
    qty: l.qty as number,
    refundPaise: l.refund_paise as number,
    restocked: l.restocked === 1,
  }));
  return {
    id: r.id as number,
    returnNo: r.return_no as string,
    invoiceId: r.invoice_id as number,
    invoiceNo: r.invoice_no as string,
    createdAt: r.created_at as string,
    businessDate: r.business_date as string,
    reason: r.reason as string,
    refundMode: r.refund_mode as string,
    refundPaise: r.refund_paise as number,
    createdBy: r.username as string,
    lines,
  };
}

export function listReturns(db: Db, f: { from?: string; to?: string; invoiceId?: number; limit?: number; offset?: number }): { rows: ReturnDTO[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) {
    where.push('business_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('business_date <= ?');
    params.push(f.to);
  }
  if (f.invoiceId) {
    where.push('invoice_id = ?');
    params.push(f.invoiceId);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) c FROM returns ${w}`).get(...params) as { c: number }).c;
  const ids = db.prepare(`SELECT id FROM returns ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, f.limit ?? 100, f.offset ?? 0) as { id: number }[];
  return { rows: ids.map((i) => getReturn(db, i.id)), total };
}

/**
 * Full or partial return against a completed invoice. The refund for each returned unit is the amount the
 * customer actually paid for it (list price less discount, plus exclusive tax). The last unit of a line,
 * and the last line of an invoice, absorb rounding so refunds never exceed what was paid.
 */
export function createReturn(ctx: Ctx, input: z.input<typeof returnSchema>): ReturnDTO {
  const r = returnSchema.parse(input);
  return tx(ctx.db, () => {
    const dup = ctx.db.prepare('SELECT id FROM returns WHERE client_request_id = ?').get(r.clientRequestId) as { id: number } | undefined;
    if (dup) return getReturn(ctx.db, dup.id);
    const approver = requireOrApproval(ctx, 'sales.refund', r.approval);
    const inv = getInvoice(ctx.db, r.invoiceId);
    if (inv.status !== 'completed') throw new AppError('CONFLICT', 'Returns can only be recorded against completed bills');

    const taxExclusive = inv.taxEnabled && !inv.taxInclusive;
    const lineTotal = (net: number) => (taxExclusive ? net + roundDiv(net * inv.taxRateBp, 10000) : net);
    const seen = new Set<number>();
    const planned: { line: (typeof inv.lines)[number]; qty: number; restock: boolean; refund: number }[] = [];
    for (const rl of r.lines) {
      if (seen.has(rl.invoiceLineId)) throw new AppError('VALIDATION', 'The same bill line was selected twice');
      seen.add(rl.invoiceLineId);
      const line = inv.lines.find((l) => l.id === rl.invoiceLineId);
      if (!line) throw new AppError('VALIDATION', 'Line does not belong to this bill');
      const remaining = line.qty - line.returnedQty;
      if (rl.qty > remaining) throw new AppError('VALIDATION', `Only ${remaining} of ${line.nameEn} can still be returned`);
      const alreadyRefunded = (ctx.db.prepare('SELECT COALESCE(SUM(refund_paise),0) s FROM return_lines WHERE invoice_line_id = ?').get(line.id) as { s: number }).s;
      const total = lineTotal(line.netPaise);
      const refund = rl.qty === remaining ? total - alreadyRefunded : roundDiv(total * rl.qty, line.qty);
      planned.push({ line, qty: rl.qty, restock: rl.restock, refund });
    }
    let refundTotal = planned.reduce((s, p) => s + p.refund, 0);

    // If this return completes the whole invoice, refund exactly what is still outstanding (absorbs invoice-level rounding).
    const allBack = inv.lines.every((l) => l.returnedQty + (planned.find((p) => p.line.id === l.id)?.qty ?? 0) === l.qty);
    if (allBack) {
      const priorRefunded = (ctx.db.prepare('SELECT COALESCE(SUM(refund_paise),0) s FROM returns WHERE invoice_id = ?').get(inv.id) as { s: number }).s;
      const outstanding = Math.min(inv.totalPaise, inv.paidPaise) - priorRefunded;
      const diff = outstanding - refundTotal;
      if (diff !== 0 && Math.abs(diff) <= Math.abs(inv.discountRoundingPaise) + inv.lines.length * 2 + 2 && planned.length) {
        planned[planned.length - 1].refund += diff;
        refundTotal = outstanding;
      }
    }
    const priorRefunded = (ctx.db.prepare('SELECT COALESCE(SUM(refund_paise),0) s FROM returns WHERE invoice_id = ?').get(inv.id) as { s: number }).s;
    if (priorRefunded + refundTotal > inv.paidPaise) throw new AppError('VALIDATION', 'The refund would exceed the amount received on this bill');

    const now = ctx.now();
    const ts = isoNow(now);
    const no = formatNumber('RET', nextCounter(ctx.db, 'return'), 5);
    const id = Number(
      ctx.db
        .prepare('INSERT INTO returns (return_no, invoice_id, business_date, created_at, created_by, approved_by, reason, refund_mode, refund_paise, client_request_id) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(no, inv.id, businessDate(now), ts, ctx.user.id, approver?.id ?? null, r.reason, r.refundMode, refundTotal, r.clientRequestId).lastInsertRowid,
    );
    const insLine = ctx.db.prepare('INSERT INTO return_lines (return_id, invoice_line_id, product_id, qty, refund_paise, restocked) VALUES (?,?,?,?,?,?)');
    for (const p of planned) {
      insLine.run(id, p.line.id, p.line.productId, p.qty, p.refund, p.restock ? 1 : 0);
      recordMovement(ctx, {
        productId: p.line.productId,
        type: p.restock ? 'return_restock' : 'return_damaged',
        qtyDelta: p.restock ? p.qty : 0,
        reason: p.restock ? `Return ${no} of ${inv.invoiceNo}: ${r.reason}` : `Return ${no} of ${inv.invoiceNo} - ${p.qty} unit(s) damaged, not restocked: ${r.reason}`,
        refType: 'return',
        refId: id,
      });
    }
    if (refundTotal > 0) {
      ctx.db
        .prepare("INSERT INTO payments (invoice_id, kind, mode, amount_paise, tendered_paise, reference, return_id, business_date, created_at, created_by) VALUES (?,'refund',?,?,NULL,?,?,?,?,?)")
        .run(inv.id, r.refundMode, refundTotal, `Refund ${no}`, id, businessDate(now), ts, ctx.user.id);
    }
    audit({ ...ctx, approver }, { action: 'return.create', entity: 'returns', entityId: id, details: { returnNo: no, invoiceNo: inv.invoiceNo, refundPaise: refundTotal, mode: r.refundMode, reason: r.reason, lines: planned.map((p) => ({ line: p.line.lineNo, qty: p.qty, restock: p.restock })) } });
    return getReturn(ctx.db, id);
  });
}
