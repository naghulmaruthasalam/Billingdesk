import type { Approval, Ctx } from './types';
import type { Permission } from '../shared/permissions';
import { AppError } from './errors';
import { verifyApproval } from './auth';

export const can = (ctx: Pick<Ctx, 'user'>, p: Permission): boolean => ctx.user.permissions.includes(p);

export function requirePermission(ctx: Pick<Ctx, 'user'>, p: Permission): void {
  if (!can(ctx, p)) throw new AppError('FORBIDDEN', 'You do not have permission to do this', { permission: p });
}

/**
 * Allow an operation when the signed-in user holds `p`, or when a supervisor who holds it supplies
 * valid credentials for this single operation. Returns the approving supervisor (if any) so it can be audited.
 */
export function requireOrApproval(ctx: Pick<Ctx, 'user' | 'db' | 'now'>, p: Permission, approval?: Approval | null): { id: number; username: string } | null {
  if (can(ctx, p)) return null;
  if (!approval) throw new AppError('FORBIDDEN', 'Supervisor approval is required for this action', { permission: p, needsApproval: true });
  return verifyApproval(ctx.db, ctx.now(), approval, p);
}
