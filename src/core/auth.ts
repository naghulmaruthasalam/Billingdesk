import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Db } from './db/connection';
import type { Approval, Ctx, SessionUser } from './types';
import { AppError } from './errors';
import { auditSystem, audit } from './audit';
import { isoNow } from './time';
import { getSetting, putSetting } from './settings';
import { DEFAULT_ROLE_PERMISSIONS, ROLE_LABELS, type Permission, type RoleName } from '../shared/permissions';

const BCRYPT_COST = 10;
const MAX_FAILED = 5;
const LOCK_MINUTES = 5;
export const MIN_PASSWORD_LENGTH = 6;

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role_id: number;
  active: number;
  failed_attempts: number;
  locked_until: string | null;
}

let _dummy: string | null = null;
const dummyHash = (): string => (_dummy ??= bcrypt.hashSync('timing-equalizer', BCRYPT_COST));

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, BCRYPT_COST);
}

export function checkPasswordPolicy(pw: string): void {
  if (pw.length < MIN_PASSWORD_LENGTH) throw new AppError('VALIDATION', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
}

export function needsSetup(db: Db): boolean {
  return (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c === 0;
}

export function loadPermissions(db: Db, roleId: number): Permission[] {
  return (db.prepare('SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission').all(roleId) as { permission: Permission }[]).map((r) => r.permission);
}

export function buildSessionUser(db: Db, userId: number): SessionUser {
  const row = db
    .prepare('SELECT u.id, u.username, u.display_name, u.role_id, r.name AS role, r.label AS role_label FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?')
    .get(userId) as { id: number; username: string; display_name: string; role_id: number; role: string; role_label: string } | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'User not found');
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, roleLabel: row.role_label, permissions: loadPermissions(db, row.role_id) };
}

function newRecoveryCode(): string {
  const raw = randomBytes(10).toString('hex').toUpperCase();
  return raw.match(/.{4}/g)!.join('-');
}

/** First-run: create the owner account and return a one-time recovery code. */
export function setupOwner(db: Db, now: Date, input: { username: string; displayName: string; password: string }): { user: SessionUser; recoveryCode: string } {
  if (!needsSetup(db)) throw new AppError('CONFLICT', 'Setup has already been completed');
  checkPasswordPolicy(input.password);
  const role = db.prepare("SELECT id FROM roles WHERE name = 'owner'").get() as { id: number };
  const code = newRecoveryCode();
  const id = db.transaction(() => {
    const ts = isoNow(now);
    const info = db.prepare('INSERT INTO users (username, display_name, password_hash, role_id, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(input.username, input.displayName, hashPassword(input.password), role.id, ts, ts);
    putSetting(db, now, 'auth.recovery_hash', hashPassword(code));
    auditSystem(db, now, 'auth.setup_owner', input.username, { userId: info.lastInsertRowid }, 'users');
    return Number(info.lastInsertRowid);
  })();
  return { user: buildSessionUser(db, id), recoveryCode: code };
}

export function login(db: Db, now: Date, username: string, password: string): SessionUser {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  const generic = new AppError('UNAUTHENTICATED', 'Incorrect username or password');
  if (!u) {
    // Burn comparable time so unknown usernames are not distinguishable by timing.
    bcrypt.compareSync(password, dummyHash());
    auditSystem(db, now, 'auth.login_failed', username, { reason: 'unknown_user' });
    throw generic;
  }
  if (!u.active) {
    auditSystem(db, now, 'auth.login_failed', username, { reason: 'inactive' });
    throw new AppError('UNAUTHENTICATED', 'This account is disabled. Ask the owner to enable it.');
  }
  if (u.locked_until && u.locked_until > isoNow(now)) {
    throw new AppError('LOCKED', 'Too many failed attempts. Try again in a few minutes.');
  }
  if (!bcrypt.compareSync(password, u.password_hash)) {
    const attempts = u.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED ? isoNow(new Date(now.getTime() + LOCK_MINUTES * 60_000)) : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : attempts, lock, u.id);
    auditSystem(db, now, 'auth.login_failed', username, { reason: 'bad_password', attempts });
    throw generic;
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(isoNow(now), u.id);
  auditSystem(db, now, 'auth.login', username);
  return buildSessionUser(db, u.id);
}

/**
 * Verify a supervisor's credentials and that they hold `permission`. Used when the signed-in user lacks a
 * permission but a supervisor approves the single operation.
 */
export function verifyApproval(db: Db, now: Date, approval: Approval, permission: Permission): { id: number; username: string } {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(approval.username) as UserRow | undefined;
  if (!u || (u.locked_until && u.locked_until > isoNow(now)) || !bcrypt.compareSync(approval.password, u.password_hash)) {
    auditSystem(db, now, 'auth.approval_failed', approval.username, { permission });
    throw new AppError('FORBIDDEN', 'Supervisor approval failed: incorrect credentials');
  }
  if (!loadPermissions(db, u.role_id).includes(permission)) {
    auditSystem(db, now, 'auth.approval_denied', approval.username, { permission });
    throw new AppError('FORBIDDEN', 'That user is not allowed to approve this action');
  }
  return { id: u.id, username: u.username };
}

/** Re-confirm the signed-in user's own password for destructive operations. */
export function confirmOwnPassword(ctx: Ctx, password: string | undefined): void {
  const u = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id) as { password_hash: string } | undefined;
  if (!password || !u || !bcrypt.compareSync(password, u.password_hash)) throw new AppError('FORBIDDEN', 'Password confirmation failed');
}

export function changeOwnPassword(ctx: Ctx, current: string, next: string): void {
  confirmOwnPassword(ctx, current);
  checkPasswordPolicy(next);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(next), isoNow(ctx.now()), ctx.user.id);
    audit(ctx, { action: 'auth.password_change', entity: 'users', entityId: ctx.user.id });
  })();
}

/**
 * Owner recovery: a printed/stored one-time recovery code resets the owner password (and rotates the
 * code). No business data is touched.
 */
export function recoverOwner(db: Db, now: Date, input: { recoveryCode: string; newPassword: string }): { recoveryCode: string } {
  checkPasswordPolicy(input.newPassword);
  const stored = getSetting(db, 'auth.recovery_hash');
  const normalized = input.recoveryCode.trim().toUpperCase();
  if (!stored || !bcrypt.compareSync(normalized, stored)) {
    auditSystem(db, now, 'auth.recovery_failed', null);
    throw new AppError('FORBIDDEN', 'Recovery code is not valid');
  }
  const owner = db.prepare("SELECT u.id, u.username FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'owner' ORDER BY u.id LIMIT 1").get() as { id: number; username: string };
  const code = newRecoveryCode();
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, active = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(hashPassword(input.newPassword), isoNow(now), owner.id);
    putSetting(db, now, 'auth.recovery_hash', hashPassword(code));
    auditSystem(db, now, 'auth.owner_recovered', owner.username, undefined, 'users');
  })();
  return { recoveryCode: code };
}

export function seedRoles(db: Db): void {
  const exists = db.prepare('SELECT COUNT(*) c FROM roles').get() as { c: number };
  if (exists.c > 0) return;
  db.transaction(() => {
    for (const name of Object.keys(DEFAULT_ROLE_PERMISSIONS) as RoleName[]) {
      const info = db.prepare('INSERT INTO roles (name, label) VALUES (?,?)').run(name, ROLE_LABELS[name]);
      for (const p of DEFAULT_ROLE_PERMISSIONS[name]) db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?,?)').run(info.lastInsertRowid, p);
    }
  })();
}
