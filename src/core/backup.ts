import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Db } from './db/connection';
import { openDatabase, currentSchemaVersion, LATEST_SCHEMA_VERSION } from './db/connection';
import { AppError } from './errors';
import { TIMEZONE } from './time';

export type BackupLabel = 'manual' | 'auto' | 'pre-migrate' | 'pre-restore';
const NAME_RE = /^skbilling-(\d{8})-(\d{6})-(manual|auto|pre-migrate|pre-restore)\.sqlite$/;

export interface BackupInfo {
  file: string;
  name: string;
  label: BackupLabel;
  sizeBytes: number;
  createdAt: string;
}

function stamp(d: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g('year')}${g('month')}${g('day')}`, time: `${g('hour')}${g('minute')}${g('second')}` };
}

export interface IntegrityResult {
  ok: boolean;
  messages: string[];
}

/** SQLite integrity_check plus foreign_key_check. */
export function integrityCheck(db: Db): IntegrityResult {
  const messages: string[] = [];
  const ic = db.pragma('integrity_check') as { integrity_check: string }[];
  for (const r of ic) if (r.integrity_check !== 'ok') messages.push(r.integrity_check);
  const fk = db.pragma('foreign_key_check') as { table: string; rowid: number; parent: string }[];
  for (const r of fk.slice(0, 20)) messages.push(`Foreign key violation in ${r.table} (row ${r.rowid}) referencing ${r.parent}`);
  return { ok: messages.length === 0, messages };
}

/**
 * Create a consistent snapshot using SQLite's online backup API (safe with WAL and concurrent writers - it
 * never copies the raw file). The snapshot is converted to a self-contained single file and verified.
 */
export async function createBackup(db: Db, destDir: string, now: Date, label: BackupLabel): Promise<BackupInfo> {
  try {
    mkdirSync(destDir, { recursive: true });
    const { date, time } = stamp(now);
    const name = `skbilling-${date}-${time}-${label}.sqlite`;
    const final = join(destDir, name);
    const partial = `${final}.partial`;
    if (existsSync(final)) {
      // Two backups in the same second (e.g. migrate + manual): keep both.
      return { file: final, name, label, sizeBytes: statSync(final).size, createdAt: statSync(final).mtime.toISOString() };
    }
    await db.backup(partial);
    const copy = openDatabase(partial);
    try {
      copy.pragma('journal_mode = DELETE');
      const res = integrityCheck(copy);
      if (!res.ok) throw new Error(`Backup failed verification: ${res.messages.join('; ')}`);
    } finally {
      copy.close();
    }
    for (const ext of ['-wal', '-shm']) rmSync(`${partial}${ext}`, { force: true });
    renameSync(partial, final);
    const st = statSync(final);
    return { file: final, name, label, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
  } catch (e) {
    throw new AppError('BACKUP', `Backup failed: ${e instanceof Error ? e.message : String(e)}. Check that the folder exists, is writable and has free space.`);
  }
}

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => NAME_RE.test(n))
    .map((n) => {
      const file = join(dir, n);
      const st = statSync(file);
      return { file, name: n, label: NAME_RE.exec(n)![3] as BackupLabel, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Keep the newest `keep` automatic backups; manual, pre-migrate and pre-restore backups are never pruned. */
export function pruneBackups(dir: string, keep: number): string[] {
  const autos = listBackups(dir).filter((b) => b.label === 'auto');
  const removed: string[] = [];
  for (const b of autos.slice(keep)) {
    rmSync(b.file, { force: true });
    removed.push(b.name);
  }
  return removed;
}

export interface BackupInspection {
  valid: boolean;
  errors: string[];
  schemaVersion: number;
  currentSchemaVersion: number;
  needsMigration: boolean;
  sizeBytes: number;
  fileModified: string;
  counts: { products: number; invoices: number; users: number; customers: number };
  lastInvoiceDate: string | null;
  lastInvoiceNo: string | null;
}

const REQUIRED_TABLES = ['users', 'roles', 'products', 'categories', 'invoices', 'invoice_lines', 'payments', 'inventory_movements', 'settings', 'audit_logs', 'schema_migrations'];

/** Validate a candidate backup file without touching the live database. */
export function inspectBackup(file: string): BackupInspection {
  const base: BackupInspection = { valid: false, errors: [], schemaVersion: 0, currentSchemaVersion: LATEST_SCHEMA_VERSION, needsMigration: false, sizeBytes: 0, fileModified: '', counts: { products: 0, invoices: 0, users: 0, customers: 0 }, lastInvoiceDate: null, lastInvoiceNo: null };
  if (!existsSync(file)) return { ...base, errors: ['File not found'] };
  const st = statSync(file);
  base.sizeBytes = st.size;
  base.fileModified = st.mtime.toISOString();
  let db: Db | null = null;
  // Work on a private copy so inspecting never creates -wal/-shm files next to the user's backup.
  const tmpCopy = `${file}.inspect-${process.pid}`;
  try {
    copyFileSync(file, tmpCopy);
    db = openDatabase(tmpCopy);
    const header = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = new Set(header.map((h) => h.name));
    const missing = REQUIRED_TABLES.filter((t) => !names.has(t));
    if (missing.length) base.errors.push(`Not a Sri Krishna Billing database (missing tables: ${missing.join(', ')})`);
    const ic = integrityCheck(db);
    if (!ic.ok) base.errors.push(...ic.messages.map((m) => `Integrity check: ${m}`));
    if (!missing.length) {
      base.schemaVersion = currentSchemaVersion(db);
      if (base.schemaVersion > LATEST_SCHEMA_VERSION) base.errors.push(`This backup was made by a newer version of the application (schema ${base.schemaVersion}).`);
      base.needsMigration = base.schemaVersion < LATEST_SCHEMA_VERSION;
      const c = (t: string) => (db!.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
      base.counts = { products: c('products'), invoices: c('invoices'), users: c('users'), customers: names.has('customers') ? c('customers') : 0 };
      const last = db.prepare('SELECT invoice_no, business_date FROM invoices ORDER BY id DESC LIMIT 1').get() as { invoice_no: string; business_date: string } | undefined;
      base.lastInvoiceDate = last?.business_date ?? null;
      base.lastInvoiceNo = last?.invoice_no ?? null;
      if (base.counts.users === 0) base.errors.push('The backup contains no user accounts');
    }
  } catch (e) {
    base.errors.push(`Cannot read this file as a database: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    db?.close();
    for (const ext of ['', '-wal', '-shm', '-journal']) rmSync(`${tmpCopy}${ext}`, { force: true });
  }
  base.valid = base.errors.length === 0;
  return base;
}

/**
 * Replace the database file at `target` with `source` (already inspected). The caller must have closed its
 * connection. Stale -wal/-shm files are removed so old frames can never be replayed into the restored file.
 */
export function replaceDatabaseFile(source: string, target: string): void {
  const tmp = `${target}.restoring`;
  copyFileSync(source, tmp);
  for (const ext of ['-wal', '-shm', '-journal']) rmSync(`${target}${ext}`, { force: true });
  renameSync(tmp, target);
}

export const backupName = (p: string): string => basename(p);
