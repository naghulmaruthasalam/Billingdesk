import Database from 'better-sqlite3';
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from './schema';
import { isoNow } from '../time';

export type Db = Database.Database;

export interface OpenOptions {
  readonly?: boolean;
}

/** Open a SQLite database with the pragmas this application depends on. */
export function openDatabase(file: string, opts: OpenOptions = {}): Db {
  const db = new Database(file, { readonly: opts.readonly ?? false, fileMustExist: opts.readonly ?? false });
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  if (!opts.readonly && file !== ':memory:') {
    db.pragma('journal_mode = WAL');
    // FULL: committed bills survive power loss; the shop's volume makes the cost irrelevant.
    db.pragma('synchronous = FULL');
  }
  return db;
}

export function currentSchemaVersion(db: Db): number {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!t) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return row.v ?? 0;
}

export interface MigrateOptions {
  now?: () => Date;
  /** Called (once) before any pending migration runs, e.g. to take a safety backup. May be async-free only. */
  beforeMigrate?: (from: number, to: number) => void;
  migrations?: typeof MIGRATIONS;
}

/** Apply all pending migrations, each in its own transaction. Returns the versions applied. */
export function migrate(db: Db, opts: MigrateOptions = {}): number[] {
  const migrations = opts.migrations ?? MIGRATIONS;
  const now = opts.now ?? (() => new Date());
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const from = currentSchemaVersion(db);
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  if (from > latest) {
    throw new Error(`Database schema version ${from} is newer than this application supports (${latest}). Install a newer version of the application.`);
  }
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return [];
  if (from > 0) opts.beforeMigrate?.(from, latest);
  const applied: number[] = [];
  for (const m of pending) {
    // Foreign key enforcement is a no-op inside a transaction, so toggling is only needed for table rebuilds.
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)').run(m.version, m.name, isoNow(now()));
    })();
    applied.push(m.version);
  }
  return applied;
}

export { LATEST_SCHEMA_VERSION };

/** Run `fn` inside an IMMEDIATE transaction (takes the write lock up front, avoiding deadlocks with other writers). */
export function tx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn).immediate();
}
