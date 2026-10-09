import type { Db } from './db/connection';
import type { Ctx } from './types';
import { isoNow } from './time';

export interface AuditInput {
  action: string;
  entity?: string;
  entityId?: string | number | null;
  details?: unknown;
}

/** Append an audit event. Must be called inside the same transaction as the change it records. */
export function audit(ctx: Pick<Ctx, 'db' | 'user' | 'now' | 'approver'>, e: AuditInput): void {
  ctx.db
    .prepare('INSERT INTO audit_logs (ts, user_id, username, approver_username, action, entity, entity_id, details) VALUES (?,?,?,?,?,?,?,?)')
    .run(isoNow(ctx.now()), ctx.user.id, ctx.user.username, ctx.approver?.username ?? null, e.action, e.entity ?? null, e.entityId == null ? null : String(e.entityId), e.details === undefined ? null : JSON.stringify(e.details));
}

/** Audit event not tied to an authenticated user (login failures, first-run setup, restore). */
export function auditSystem(db: Db, now: Date, action: string, username: string | null, details?: unknown, entity?: string): void {
  db.prepare('INSERT INTO audit_logs (ts, user_id, username, action, entity, details) VALUES (?,?,?,?,?,?)').run(isoNow(now), null, username, action, entity ?? null, details === undefined ? null : JSON.stringify(details));
}

export interface AuditRow {
  id: number;
  ts: string;
  username: string | null;
  approver_username: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: string | null;
}

export function listAudit(db: Db, f: { action?: string; search?: string; limit?: number; offset?: number }): { rows: AuditRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.action) {
    where.push('action LIKE ?');
    params.push(`${f.action}%`);
  }
  if (f.search) {
    where.push('(username LIKE ? OR details LIKE ? OR entity_id LIKE ?)');
    params.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) c FROM audit_logs ${w}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`SELECT id, ts, username, approver_username, action, entity, entity_id, details FROM audit_logs ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, f.limit ?? 100, f.offset ?? 0) as AuditRow[];
  return { rows, total };
}
