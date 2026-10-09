import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { makeApp, product, setStock, rid, expectError, OWNER } from './helpers';
import { inspectBackup, listBackups, pruneBackups, createBackup, integrityCheck } from '../src/core/backup';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skbilling-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function appWithSales(dbName = 'live.sqlite') {
  const app = await makeApp({ dbPath: join(dir, dbName), backupDir: join(dir, 'auto') });
  const p = await setStock(app, 'SK-045', 20);
  const inv = await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 3 }], payments: [{ mode: 'cash', amountPaise: 50000 }] });
  return { app, p, inv };
}

describe('backup', () => {
  it('runs the live database in WAL mode inside the data directory', async () => {
    const { app } = await appWithSales();
    expect(app.rt.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(app.rt.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(app.rt.dbPath.startsWith(dir)).toBe(true);
    app.rt.close();
  });

  it('captures committed data that is still only in the WAL file', async () => {
    const { app, inv } = await appWithSales();
    expect(existsSync(join(dir, 'live.sqlite-wal'))).toBe(true);
    expect(statSync(join(dir, 'live.sqlite-wal')).size).toBeGreaterThan(0); // data not yet checkpointed into the main file
    const info = await app.call('backup:createTo', { dir: join(dir, 'manual') });
    expect(info.name).toMatch(/^skbilling-\d{8}-\d{6}-manual\.sqlite$/);
    expect(existsSync(`${info.file}-wal`)).toBe(false); // a single self-contained file
    const copy = new Database(info.file, { readonly: true });
    const row = copy.prepare('SELECT invoice_no, total_paise FROM invoices').get() as any;
    expect(row).toEqual({ invoice_no: inv.invoiceNo, total_paise: inv.totalPaise });
    copy.close();
    app.rt.close();
  });

  it('validates a backup before restore: preview, corrupt and foreign files', async () => {
    const { app, inv } = await appWithSales();
    const info = await app.call('backup:createTo', { dir: join(dir, 'manual') });
    const good = await app.call('backup:inspect', { file: info.file });
    expect(good).toMatchObject({ valid: true, needsMigration: false, lastInvoiceNo: inv.invoiceNo });
    expect(good.counts).toMatchObject({ products: 114, invoices: 1, users: 1 });
    const garbage = join(dir, 'garbage.sqlite');
    writeFileSync(garbage, 'this is not a database'.repeat(100));
    expect(inspectBackup(garbage).valid).toBe(false);
    const foreign = join(dir, 'foreign.sqlite');
    const f = new Database(foreign);
    f.exec('CREATE TABLE notes (a TEXT)');
    f.close();
    const r = inspectBackup(foreign);
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/missing tables/);
    expect(inspectBackup(join(dir, 'nope.sqlite')).errors).toEqual(['File not found']);
    // a truncated copy fails integrity or open
    const trunc = join(dir, 'trunc.sqlite');
    copyFileSync(info.file, trunc);
    const buf = readdirSync(dir); void buf;
    const { truncateSync } = await import('node:fs');
    truncateSync(trunc, 20000);
    expect(inspectBackup(trunc).valid).toBe(false);
    app.rt.close();
  });

  it('restores into the live database, keeps a safety copy, and signs the user out', async () => {
    const { app, p } = await appWithSales();
    const info = await app.call('backup:createTo', { dir: join(dir, 'manual') });
    // more activity after the backup
    await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 2 }], payments: [{ mode: 'cash', amountPaise: 50000 }] });
    expect((await app.call('sales:list', {})).total).toBe(2);
    await expectError(app.call('backup:restore', { file: info.file, confirmPassword: 'wrong' }), 'FORBIDDEN');
    const res = await app.call('backup:restore', { file: info.file, confirmPassword: OWNER.password });
    expect(res.signedOut).toBe(true);
    expect(res.safetyBackup).toMatch(/pre-restore/);
    expect(app.rt.signedIn).toBe(false);
    await app.call('auth:login', { username: OWNER.username, password: OWNER.password });
    expect((await app.call('sales:list', {})).total).toBe(1);
    expect((await product(app, 'SK-045')).stockQty).toBe(17);
    expect(integrityCheck(app.rt.db).ok).toBe(true);
    // the pre-restore safety backup still has both bills
    const safety = new Database(join(dir, 'auto', res.safetyBackup), { readonly: true });
    expect((safety.prepare('SELECT COUNT(*) c FROM invoices').get() as any).c).toBe(2);
    safety.close();
    const log = (await app.call('audit:list', { action: 'backup' })).rows.map((r: any) => r.action);
    expect(log).toContain('backup.restore');
    app.rt.close();
  });

  it('restores a backup into a separate test location without touching the live database', async () => {
    const { app } = await appWithSales();
    const info = await app.call('backup:createTo', { dir: join(dir, 'manual') });
    const { Runtime } = await import('../src/core/runtime');
    const target = join(dir, 'restore-test', 'restored.sqlite');
    copyFileSyncMkdir(info.file, target);
    const rt2 = Runtime.open({ dbPath: target, backupDir: join(dir, 'restore-test', 'b') });
    expect((rt2.db.prepare('SELECT COUNT(*) c FROM invoices').get() as any).c).toBe(1);
    expect(integrityCheck(rt2.db).ok).toBe(true);
    rt2.close();
    app.rt.close();
  });

  it('refuses a backup from a newer application version and leaves live data untouched', async () => {
    const { app } = await appWithSales();
    const info = await app.call('backup:createTo', { dir: join(dir, 'manual') });
    // Corrupt a copy of the backup in a way inspection cannot see: break schema_migrations only after inspection by
    // pointing at a file that passes inspection but makes migrate fail (version newer than supported).
    const bad = join(dir, 'newer.sqlite');
    copyFileSync(info.file, bad);
    const d = new Database(bad);
    d.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'future', 'x')").run();
    d.close();
    const check = inspectBackup(bad);
    expect(check.valid).toBe(false);
    expect(check.errors.join()).toMatch(/newer version/);
    await expectError(app.call('backup:restore', { file: bad, confirmPassword: OWNER.password }), 'BACKUP', 'cannot be restored');
    expect((await app.call('sales:list', {})).total).toBe(1); // untouched and still signed in
    app.rt.close();
  });


  it('puts the previous data back automatically if the restored file fails after being swapped in', async () => {
    const { app, p } = await appWithSales();
    const info = await app.call('backup:createTo', { dir: join(dir, 'manual') });
    await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 1 }], payments: [{ mode: 'cash', amountPaise: 50000 }] });
    const rt = app.rt as any;
    const real = rt.initialise.bind(rt);
    let calls = 0;
    vi.spyOn(rt, 'initialise').mockImplementation(() => {
      calls++;
      if (calls === 1) throw new Error('simulated post-restore failure');
      real();
    });
    await expectError(app.call('backup:restore', { file: info.file, confirmPassword: OWNER.password }), 'BACKUP', 'previous data was put back');
    await app.call('auth:login', { username: OWNER.username, password: OWNER.password });
    expect((await app.call('sales:list', {})).total).toBe(2); // the post-backup bill is still there
    app.rt.close();
  });

  it('applies retention only to automatic backups and runs the daily auto backup once per day', async () => {
    const { app } = await appWithSales();
    const autoDir = join(dir, 'auto');
    const first = await app.rt.runAutoBackupIfDue();
    expect(first?.label).toBe('auto');
    expect(await app.rt.runAutoBackupIfDue()).toBeNull(); // same business day
    app.setClock(new Date('2025-10-21T06:30:00Z'));
    expect(await app.rt.runAutoBackupIfDue()).not.toBeNull();
    await app.call('settings:update', { patch: { 'backup.retention_count': 1 } });
    await createBackup(app.rt.db, autoDir, new Date('2025-10-22T06:30:00Z'), 'manual');
    app.setClock(new Date('2025-10-22T06:30:00Z'));
    await app.rt.runAutoBackupIfDue();
    const names = listBackups(autoDir);
    expect(names.filter((b) => b.label === 'auto')).toHaveLength(1);
    expect(names.filter((b) => b.label === 'manual')).toHaveLength(1);
    expect(pruneBackups(autoDir, 5)).toEqual([]);
    await app.call('settings:update', { patch: { 'backup.auto_enabled': false } });
    app.setClock(new Date('2025-10-25T06:30:00Z'));
    expect(await app.rt.runAutoBackupIfDue()).toBeNull();
    app.rt.close();
  });

  it('reports a clear error when the backup folder cannot be used', async () => {
    const { app } = await appWithSales();
    const blocker = join(dir, 'a-file');
    writeFileSync(blocker, 'x');
    await expectError(app.call('backup:createTo', { dir: join(blocker, 'sub') }), 'BACKUP', 'Backup failed');
    app.rt.close();
  });

  it('verifies database integrity on demand', async () => {
    const { app } = await appWithSales();
    expect(await app.call('backup:integrity')).toEqual({ ok: true, messages: [] });
    app.rt.close();
  });
});

function copyFileSyncMkdir(src: string, dest: string) {
  const { mkdirSync } = require('node:fs');
  mkdirSync(join(dest, '..'), { recursive: true });
  copyFileSync(src, dest);
}
