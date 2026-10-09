import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from '../src/core/db/schema';
import { currentSchemaVersion, migrate, openDatabase } from '../src/core/db/connection';
import { Runtime } from '../src/core/runtime';
import { dispatch } from '../src/core/api';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skbilling-mig-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migrations', () => {
  it('builds a fresh database to the latest version with foreign keys on', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(migrate(db)).toEqual([]); // idempotent
    const fks = db.pragma('foreign_key_check');
    expect(fks).toEqual([]);
    db.close();
  });

  it('upgrades an existing v1 database in place, preserving data and taking a safety backup', async () => {
    const file = join(dir, 'old.sqlite');
    const backups = join(dir, 'backups');
    // Build a v1 database containing real data.
    const old = openDatabase(file);
    migrate(old, { migrations: MIGRATIONS.slice(0, 1) });
    expect(currentSchemaVersion(old)).toBe(1);
    old.prepare("INSERT INTO roles (name, label) VALUES ('owner','Owner')").run();
    old.prepare("INSERT INTO users (username, display_name, password_hash, role_id, created_at, updated_at) VALUES ('legacy','Legacy','x',1,'t','t')").run();
    old.prepare("INSERT INTO categories (name_en, created_at, updated_at) VALUES ('Legacy Cat','t','t')").run();
    old.prepare("INSERT INTO products (sku, name_en, category_id, unit, price_paise, stock_qty, created_at, updated_at) VALUES ('OLD-1','Old Item',1,'Box',1234,9,'t','t')").run();
    old.prepare("INSERT INTO invoices (invoice_no, seq, client_request_id, business_date, created_at, cashier_id, subtotal_paise, discount_paise, total_paise, rounding_scope, rounding_unit) VALUES ('X-1',1,'abc12345','2025-10-01','t',1,1234,0,1234,'line','paisa')").run();
    old.close();

    const rt = Runtime.open({ dbPath: file, backupDir: backups });
    expect(rt.migrationsApplied).toEqual([2]);
    expect(currentSchemaVersion(rt.db)).toBe(LATEST_SCHEMA_VERSION);
    expect(rt.db.prepare("SELECT price_paise, stock_qty FROM products WHERE sku='OLD-1'").get()).toEqual({ price_paise: 1234, stock_qty: 9 });
    expect(rt.db.prepare('SELECT invoice_no FROM invoices').get()).toEqual({ invoice_no: 'X-1' });
    expect(rt.db.prepare("SELECT COUNT(*) c FROM pragma_table_info('products') WHERE name='reviewed_at'").get()).toEqual({ c: 1 });
    // a pre-migrate copy exists and still holds the v1 schema
    const files = readdirSync(backups);
    expect(files.some((f) => f.endsWith('-pre-migrate.sqlite'))).toBe(true);
    const copy = openDatabase(join(backups, files.find((f) => f.includes('pre-migrate'))!), { readonly: true });
    expect(currentSchemaVersion(copy)).toBe(1);
    copy.close();
    // existing data is not re-seeded over: legacy catalogue stays alongside the seeded one
    const r: any = await dispatch(rt, 'auth:status', {});
    expect(r.data.needsSetup).toBe(false);
    rt.close();

    // reopening is a no-op
    const again = Runtime.open({ dbPath: file, backupDir: backups });
    expect(again.migrationsApplied).toEqual([]);
    again.close();
  });

  it('refuses to open a database from a newer application version', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'future', 't')").run();
    expect(() => migrate(db)).toThrow(/newer than this application supports/);
    db.close();
  });

  it('rolls a failed migration back completely', () => {
    const db = openDatabase(':memory:');
    migrate(db, { migrations: MIGRATIONS.slice(0, 1) });
    const broken = [...MIGRATIONS.slice(0, 1), { version: 2, name: 'broken', sql: 'ALTER TABLE products ADD COLUMN ok_col TEXT; SELECT * FROM table_that_does_not_exist;' }];
    expect(() => migrate(db, { migrations: broken })).toThrow();
    expect(currentSchemaVersion(db)).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM pragma_table_info('products') WHERE name='ok_col'").get()).toEqual({ c: 0 });
    db.close();
  });
});
