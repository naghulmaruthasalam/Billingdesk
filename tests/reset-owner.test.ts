import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Runtime } from '../src/core/runtime';
import { dispatch } from '../src/core/api';
import { OWNER } from './helpers';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skbilling-reset-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const runScript = (extra: string[] = [], password = 'Brand-new-1') =>
  spawnSync(process.execPath, ['scripts/reset-owner-password.mjs', '--data-dir', dir, '--password-env', 'NEWPW', ...extra], { encoding: 'utf8', env: { ...process.env, NEWPW: password } });

describe('offline owner password reset (password and recovery code both lost)', () => {
  it('resets the password, keeps all data, saves a copy, rotates the recovery code and audits it', async () => {
    const dbPath = join(dir, 'data', 'skbilling.sqlite');
    const rt = Runtime.open({ dbPath, backupDir: join(dir, 'backups') });
    const setup: any = await dispatch(rt, 'auth:setup', OWNER);
    const oldCode = setup.data.recoveryCode as string;
    await dispatch(rt, 'auth:logout', {});
    rt.close();

    const r = runScript();
    expect(r.status, r.stderr).toBe(0);
    const newCode = /([0-9A-F]{4}(?:-[0-9A-F]{4}){4})/.exec(r.stdout)![1];
    expect(newCode).not.toBe(oldCode);
    expect(readdirSync(join(dir, 'backups')).some((f) => f.endsWith('-pre-restore.sqlite'))).toBe(true);

    const rt2 = Runtime.open({ dbPath, backupDir: join(dir, 'backups') });
    const bad: any = await dispatch(rt2, 'auth:login', { username: 'owner', password: OWNER.password });
    expect(bad.ok).toBe(false); // old password no longer works
    const ok: any = await dispatch(rt2, 'auth:login', { username: 'owner', password: 'Brand-new-1' });
    expect(ok.ok).toBe(true);
    expect(((await dispatch(rt2, 'products:list', {})) as any).data.total).toBe(114); // data untouched
    const audit: any = await dispatch(rt2, 'audit:list', { action: 'auth.owner_reset_offline' });
    expect(audit.data.rows).toHaveLength(1);
    // the old recovery code is dead; the new one works and rotates again
    await dispatch(rt2, 'auth:logout', {});
    expect(((await dispatch(rt2, 'auth:recover', { recoveryCode: oldCode, newPassword: 'Another-pw-1' })) as any).ok).toBe(false);
    expect(((await dispatch(rt2, 'auth:recover', { recoveryCode: newCode, newPassword: 'Another-pw-1' })) as any).ok).toBe(true);
    rt2.close();
  });

  it('unlocks a locked-out owner and refuses short passwords or a missing database', async () => {
    const dbPath = join(dir, 'data', 'skbilling.sqlite');
    const rt = Runtime.open({ dbPath, backupDir: join(dir, 'backups') });
    await dispatch(rt, 'auth:setup', OWNER);
    await dispatch(rt, 'auth:logout', {});
    for (let i = 0; i < 5; i++) await dispatch(rt, 'auth:login', { username: 'owner', password: 'wrong' });
    expect(((await dispatch(rt, 'auth:login', { username: 'owner', password: OWNER.password })) as any).error.code).toBe('LOCKED');
    rt.close();
    expect(runScript([], 'abc').status).toBe(1);
    expect(runScript().status).toBe(0);
    const rt2 = Runtime.open({ dbPath, backupDir: join(dir, 'backups') });
    expect(((await dispatch(rt2, 'auth:login', { username: 'owner', password: 'Brand-new-1' })) as any).ok).toBe(true);
    rt2.close();
    const empty = mkdtempSync(join(tmpdir(), 'skbilling-none-'));
    const r = spawnSync(process.execPath, ['scripts/reset-owner-password.mjs', '--data-dir', empty, '--password-env', 'NEWPW'], { encoding: 'utf8', env: { ...process.env, NEWPW: 'Brand-new-1' } });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/No database found/);
    expect(existsSync(join(empty, 'data'))).toBe(false);
    rmSync(empty, { recursive: true, force: true });
  });
});
