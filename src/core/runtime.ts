import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Db } from './db/connection';
import { migrate, openDatabase, currentSchemaVersion, LATEST_SCHEMA_VERSION } from './db/connection';
import type { Ctx, SessionUser } from './types';
import { AppError } from './errors';
import { buildSessionUser } from './auth';
import { ensureSeeded } from './seed';
import { auditSystem } from './audit';
import { createBackup, inspectBackup, integrityCheck, pruneBackups, replaceDatabaseFile, type BackupInfo } from './backup';
import { getSetting, putSetting } from './settings';
import { businessDate } from './time';

export interface RuntimeOptions {
  /** Absolute path to the live database file (inside the user-data directory, never the install directory). */
  dbPath: string;
  /** Default folder for automatic and pre-restore/pre-migrate backups. */
  backupDir: string;
  now?: () => Date;
}

export class Runtime {
  db: Db;
  private userId: number | null = null;
  readonly now: () => Date;
  readonly dbPath: string;
  readonly defaultBackupDir: string;
  migrationsApplied: number[] = [];

  private constructor(private readonly opts: RuntimeOptions, db: Db) {
    this.db = db;
    this.now = opts.now ?? (() => new Date());
    this.dbPath = opts.dbPath;
    this.defaultBackupDir = opts.backupDir;
  }

  static open(opts: RuntimeOptions): Runtime {
    if (opts.dbPath !== ':memory:') mkdirSync(dirname(opts.dbPath), { recursive: true });
    const db = openDatabase(opts.dbPath);
    const rt = new Runtime(opts, db);
    rt.initialise();
    return rt;
  }

  private initialise(): void {
    const now = this.now();
    this.migrationsApplied = migrate(this.db, {
      now: this.now,
      beforeMigrate: (from) => {
        // Safety copy of the pre-migration database. VACUUM INTO is synchronous and consistent under WAL.
        if (this.dbPath === ':memory:') return;
        mkdirSync(this.opts.backupDir, { recursive: true });
        const name = `skbilling-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-pre-migrate.sqlite`;
        const target = join(this.opts.backupDir, name);
        if (!existsSync(target)) this.db.prepare('VACUUM INTO ?').run(target);
        auditSystem(this.db, now, 'db.pre_migrate_backup', null, { fromVersion: from, file: name });
      },
    });
    ensureSeeded(this.db, now);
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  // -------------------------------------------------------------- session

  setSession(userId: number | null): void {
    this.userId = userId;
  }

  get signedIn(): boolean {
    return this.userId !== null;
  }

  /** Current user, re-read from the database on every call so role/permission/disable changes apply immediately. */
  user(): SessionUser | null {
    if (this.userId === null) return null;
    const row = this.db.prepare('SELECT active FROM users WHERE id = ?').get(this.userId) as { active: number } | undefined;
    if (!row || !row.active) {
      this.userId = null;
      return null;
    }
    return buildSessionUser(this.db, this.userId);
  }

  requireUser(): SessionUser {
    const u = this.user();
    if (!u) throw new AppError('UNAUTHENTICATED', 'Please sign in');
    return u;
  }

  ctx(): Ctx {
    return { db: this.db, user: this.requireUser(), now: this.now };
  }

  // -------------------------------------------------------------- backups

  backupDir(): string {
    const dir = getSetting(this.db, 'backup.directory');
    return dir || this.defaultBackupDir;
  }

  async backupNow(dir: string | null, label: 'manual' | 'auto'): Promise<BackupInfo> {
    const info = await createBackup(this.db, dir ?? this.backupDir(), this.now(), label);
    return info;
  }

  /** Daily automatic backup. Safe to call repeatedly. */
  async runAutoBackupIfDue(): Promise<BackupInfo | null> {
    if (this.dbPath === ':memory:') return null;
    if (!getSetting(this.db, 'backup.auto_enabled')) return null;
    const today = businessDate(this.now());
    if (getSetting(this.db, 'backup.last_auto_date') === today) return null;
    const info = await createBackup(this.db, this.backupDir(), this.now(), 'auto');
    putSetting(this.db, this.now(), 'backup.last_auto_date', today);
    pruneBackups(this.backupDir(), getSetting(this.db, 'backup.retention_count'));
    auditSystem(this.db, this.now(), 'backup.auto', null, { file: info.name });
    return info;
  }

  /**
   * Restore a backup file over the live database. A pre-restore backup of the current data is taken first
   * and automatically put back if the restored file fails verification.
   */
  async restore(file: string, actor: string): Promise<{ safetyBackup: string; schemaVersion: number }> {
    if (this.dbPath === ':memory:') throw new AppError('BACKUP', 'Restore is not available for an in-memory database');
    const inspection = inspectBackup(file);
    if (!inspection.valid) throw new AppError('BACKUP', `This backup cannot be restored: ${inspection.errors.join('; ')}`);
    const safety = await createBackup(this.db, this.opts.backupDir, this.now(), 'pre-restore');
    this.db.close();
    this.userId = null;
    try {
      replaceDatabaseFile(file, this.dbPath);
      this.db = openDatabase(this.dbPath);
      this.initialise();
      const check = integrityCheck(this.db);
      if (!check.ok) throw new Error(`Integrity check failed after restore: ${check.messages.join('; ')}`);
      auditSystem(this.db, this.now(), 'backup.restore', actor, { from: file, safetyBackup: safety.name, schemaVersion: currentSchemaVersion(this.db) });
      return { safetyBackup: safety.name, schemaVersion: currentSchemaVersion(this.db) };
    } catch (e) {
      // Roll back to the pre-restore copy so the shop keeps its data.
      if (this.db.open) this.db.close();
      replaceDatabaseFile(safety.file, this.dbPath);
      this.db = openDatabase(this.dbPath);
      this.initialise();
      throw new AppError('BACKUP', `Restore failed and your previous data was put back. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  deleteFileQuietly(p: string): void {
    rmSync(p, { force: true });
  }
}

export { LATEST_SCHEMA_VERSION };
