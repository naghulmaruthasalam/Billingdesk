import { z } from 'zod';
import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { isDateString, isoNow } from './time';

export const EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Salary / Wages', 'Transport', 'Packaging', 'Licence / Fees', 'Repairs', 'Marketing', 'Other'] as const;

export const expenseSchema = z.object({
  expenseDate: z.string().refine(isDateString, 'Invalid date'),
  category: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300).nullable().optional(),
  amountPaise: z.number().int().positive('Amount must be greater than zero'),
  paymentMode: z.enum(['cash', 'upi', 'card']).default('cash'),
});

export interface ExpenseDTO {
  id: number;
  expenseDate: string;
  category: string;
  description: string | null;
  amountPaise: number;
  paymentMode: string;
  createdBy: string;
  voided: boolean;
  voidReason: string | null;
}

export function listExpenses(db: Db, f: { from?: string; to?: string; includeVoided?: boolean; limit?: number } = {}): { rows: ExpenseDTO[]; totalPaise: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from) {
    where.push('e.expense_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('e.expense_date <= ?');
    params.push(f.to);
  }
  if (!f.includeVoided) where.push('e.voided_at IS NULL');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = (
    db.prepare(`SELECT e.*, u.username FROM expenses e JOIN users u ON u.id = e.created_by ${w} ORDER BY e.expense_date DESC, e.id DESC LIMIT ?`).all(...params, f.limit ?? 500) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as number,
    expenseDate: r.expense_date as string,
    category: r.category as string,
    description: r.description as string | null,
    amountPaise: r.amount_paise as number,
    paymentMode: r.payment_mode as string,
    createdBy: r.username as string,
    voided: r.voided_at !== null,
    voidReason: r.void_reason as string | null,
  }));
  return { rows, totalPaise: rows.filter((r) => !r.voided).reduce((s, r) => s + r.amountPaise, 0) };
}

export function createExpense(ctx: Ctx, input: z.input<typeof expenseSchema>): ExpenseDTO {
  const e = expenseSchema.parse(input);
  const id = tx(ctx.db, () => {
    const nid = Number(ctx.db.prepare('INSERT INTO expenses (expense_date, category, description, amount_paise, payment_mode, created_by, created_at) VALUES (?,?,?,?,?,?,?)').run(e.expenseDate, e.category, e.description ?? null, e.amountPaise, e.paymentMode, ctx.user.id, isoNow(ctx.now())).lastInsertRowid);
    audit(ctx, { action: 'expense.create', entity: 'expenses', entityId: nid, details: { category: e.category, amountPaise: e.amountPaise } });
    return nid;
  });
  return listExpenses(ctx.db, { includeVoided: true }).rows.find((r) => r.id === id)!;
}

/** Expenses are never deleted: a void keeps the row and records who voided it and why. */
export function voidExpense(ctx: Ctx, id: number, reason: string): void {
  if (reason.trim().length < 3) throw new AppError('VALIDATION', 'Please give a reason');
  tx(ctx.db, () => {
    const info = ctx.db.prepare('UPDATE expenses SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL').run(isoNow(ctx.now()), ctx.user.id, reason.trim(), id);
    if (!info.changes) throw new AppError('NOT_FOUND', 'Expense not found or already voided');
    audit(ctx, { action: 'expense.void', entity: 'expenses', entityId: id, details: { reason } });
  });
}
