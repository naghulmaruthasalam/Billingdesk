import { z } from 'zod';
import type { Db } from './db/connection';
import { tx } from './db/connection';
import type { Ctx } from './types';
import { AppError } from './errors';
import { audit } from './audit';
import { isoNow } from './time';
import { checkPasswordPolicy, confirmOwnPassword, hashPassword } from './auth';
import { PERMISSIONS, type Permission } from '../shared/permissions';

export interface UserDTO {
  id: number;
  username: string;
  displayName: string;
  role: string;
  roleLabel: string;
  active: boolean;
  lastLoginAt: string | null;
}

export interface RoleDTO {
  id: number;
  name: string;
  label: string;
  permissions: Permission[];
}

export function listUsers(db: Db): UserDTO[] {
  return (db.prepare('SELECT u.id, u.username, u.display_name, r.name AS role, r.label, u.active, u.last_login_at FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id').all() as Record<string, unknown>[]).map((r) => ({
    id: r.id as number,
    username: r.username as string,
    displayName: r.display_name as string,
    role: r.role as string,
    roleLabel: r.label as string,
    active: r.active === 1,
    lastLoginAt: r.last_login_at as string | null,
  }));
}

export function listRoles(db: Db): RoleDTO[] {
  return (db.prepare('SELECT id, name, label FROM roles ORDER BY id').all() as { id: number; name: string; label: string }[]).map((r) => ({
    ...r,
    permissions: (db.prepare('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission').all(r.id) as { permission: Permission }[]).map((x) => x.permission),
  }));
}

export const userCreateSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9._-]+$/, 'Username may contain letters, digits, dot, dash and underscore'),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(1),
  roleId: z.number().int().positive(),
});

export function createUser(ctx: Ctx, input: z.input<typeof userCreateSchema>): UserDTO[] {
  const u = userCreateSchema.parse(input);
  checkPasswordPolicy(u.password);
  tx(ctx.db, () => {
    if (!ctx.db.prepare('SELECT 1 FROM roles WHERE id = ?').get(u.roleId)) throw new AppError('NOT_FOUND', 'Role not found');
    const ts = isoNow(ctx.now());
    try {
      const id = Number(ctx.db.prepare('INSERT INTO users (username, display_name, password_hash, role_id, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(u.username, u.displayName, hashPassword(u.password), u.roleId, ts, ts).lastInsertRowid);
      audit(ctx, { action: 'user.create', entity: 'users', entityId: id, details: { username: u.username, roleId: u.roleId } });
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) throw new AppError('CONFLICT', 'That username is already taken');
      throw e;
    }
  });
  return listUsers(ctx.db);
}

function ownerCount(db: Db, excludeUserId?: number): number {
  return (db.prepare("SELECT COUNT(*) c FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'owner' AND u.active = 1 AND u.id <> ?").get(excludeUserId ?? -1) as { c: number }).c;
}

export const userUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  roleId: z.number().int().positive().optional(),
  active: z.boolean().optional(),
  newPassword: z.string().optional(),
});

export function updateUser(ctx: Ctx, id: number, input: z.input<typeof userUpdateSchema>, confirmPassword: string | undefined): UserDTO[] {
  const u = userUpdateSchema.parse(input);
  confirmOwnPassword(ctx, confirmPassword);
  tx(ctx.db, () => {
    const cur = ctx.db.prepare('SELECT u.id, u.username, u.role_id, u.active, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(id) as { id: number; username: string; role_id: number; active: number; role: string } | undefined;
    if (!cur) throw new AppError('NOT_FOUND', 'User not found');
    const newRole = u.roleId ? (ctx.db.prepare('SELECT name FROM roles WHERE id = ?').get(u.roleId) as { name: string } | undefined) : undefined;
    if (u.roleId && !newRole) throw new AppError('NOT_FOUND', 'Role not found');
    const losesOwner = cur.role === 'owner' && ((newRole && newRole.name !== 'owner') || u.active === false);
    if (losesOwner && ownerCount(ctx.db, id) === 0) throw new AppError('VALIDATION', 'At least one active owner account must remain');
    const ts = isoNow(ctx.now());
    const changes: Record<string, unknown> = {};
    if (u.displayName !== undefined) ctx.db.prepare('UPDATE users SET display_name=?, updated_at=? WHERE id=?').run(u.displayName, ts, id);
    if (u.roleId !== undefined && u.roleId !== cur.role_id) {
      ctx.db.prepare('UPDATE users SET role_id=?, updated_at=? WHERE id=?').run(u.roleId, ts, id);
      changes.role = { from: cur.role, to: newRole!.name };
    }
    if (u.active !== undefined && (u.active ? 1 : 0) !== cur.active) {
      ctx.db.prepare('UPDATE users SET active=?, updated_at=? WHERE id=?').run(u.active ? 1 : 0, ts, id);
      changes.active = u.active;
    }
    if (u.newPassword) {
      checkPasswordPolicy(u.newPassword);
      ctx.db.prepare('UPDATE users SET password_hash=?, failed_attempts=0, locked_until=NULL, updated_at=? WHERE id=?').run(hashPassword(u.newPassword), ts, id);
      changes.passwordReset = true;
    }
    audit(ctx, { action: 'user.update', entity: 'users', entityId: id, details: { username: cur.username, ...changes } });
  });
  return listUsers(ctx.db);
}

export function setRolePermissions(ctx: Ctx, roleId: number, permissions: string[], confirmPassword: string | undefined): RoleDTO[] {
  confirmOwnPassword(ctx, confirmPassword);
  const valid = permissions.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p));
  if (valid.length !== permissions.length) throw new AppError('VALIDATION', 'Unknown permission in list');
  tx(ctx.db, () => {
    const role = ctx.db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId) as { name: string } | undefined;
    if (!role) throw new AppError('NOT_FOUND', 'Role not found');
    if (role.name === 'owner') throw new AppError('VALIDATION', 'The owner role always has every permission');
    const before = (ctx.db.prepare('SELECT permission FROM role_permissions WHERE role_id = ?').all(roleId) as { permission: string }[]).map((r) => r.permission);
    ctx.db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const ins = ctx.db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?,?)');
    for (const p of new Set(valid)) ins.run(roleId, p);
    audit(ctx, { action: 'role.permissions', entity: 'roles', entityId: roleId, details: { role: role.name, added: valid.filter((p) => !before.includes(p)), removed: before.filter((p) => !valid.includes(p as Permission)) } });
  });
  return listRoles(ctx.db);
}
