import { z } from 'zod';
import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { isoNow } from './time';

export interface CustomerDTO {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
  billCount: number;
  totalPaise: number;
  lastPurchase: string | null;
}

export const customerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\-\s]*$/, 'Phone may contain digits, spaces, + and - only')
    .nullable()
    .optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  active: z.boolean().default(true),
});

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function listCustomers(db: Db, f: { search?: string; limit?: number; offset?: number } = {}): { rows: CustomerDTO[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.search?.trim()) {
    where.push("(c.name LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')");
    const like = `%${escapeLike(f.search.trim().normalize('NFC'))}%`;
    params.push(like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) c FROM customers c ${w}`).get(...params) as { c: number }).c;
  const rows = (
    db
      .prepare(
        `SELECT c.id, c.name, c.phone, c.notes, c.active,
           (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status='completed') AS n,
           (SELECT COALESCE(SUM(i.total_paise),0) FROM invoices i WHERE i.customer_id = c.id AND i.status='completed') AS t,
           (SELECT MAX(i.business_date) FROM invoices i WHERE i.customer_id = c.id AND i.status='completed') AS last
         FROM customers c ${w} ORDER BY c.name COLLATE NOCASE LIMIT ? OFFSET ?`,
      )
      .all(...params, f.limit ?? 200, f.offset ?? 0) as Record<string, unknown>[]
  ).map((r) => ({ id: r.id as number, name: r.name as string, phone: r.phone as string | null, notes: r.notes as string | null, active: r.active === 1, billCount: r.n as number, totalPaise: r.t as number, lastPurchase: r.last as string | null }));
  return { rows, total };
}

export function saveCustomer(ctx: Ctx, id: number | null, input: z.input<typeof customerSchema>): CustomerDTO {
  const c = customerSchema.parse(input);
  const rid = tx(ctx.db, () => {
    const ts = isoNow(ctx.now());
    if (id) {
      const info = ctx.db.prepare('UPDATE customers SET name=?, phone=?, notes=?, active=?, updated_at=? WHERE id=?').run(c.name, c.phone || null, c.notes ?? null, c.active ? 1 : 0, ts, id);
      if (!info.changes) throw new AppError('NOT_FOUND', 'Customer not found');
      audit(ctx, { action: 'customer.update', entity: 'customers', entityId: id });
      return id;
    }
    const nid = Number(ctx.db.prepare('INSERT INTO customers (name, phone, notes, active, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(c.name, c.phone || null, c.notes ?? null, c.active ? 1 : 0, ts, ts).lastInsertRowid);
    audit(ctx, { action: 'customer.create', entity: 'customers', entityId: nid });
    return nid;
  });
  return listCustomers(ctx.db, { search: c.name, limit: 50 }).rows.find((x) => x.id === rid) ?? listCustomers(ctx.db).rows.find((x) => x.id === rid)!;
}
