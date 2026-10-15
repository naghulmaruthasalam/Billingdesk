import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp, product, expectError, setStock, rid } from './helpers';
import { isValidEan13 } from '../src/shared/barcode';
import { MIGRATIONS } from '../src/core/db/schema';
import { migrate, openDatabase } from '../src/core/db/connection';
import { Runtime } from '../src/core/runtime';
import { ensureBarcodes } from '../src/core/barcodes';
import { dispatch } from '../src/core/api';
import { DEFAULT_LABEL_LAYOUT, renderLabelsHtml, labelGeometry } from '../src/shared/labelHtml';

describe('barcode assignment', () => {
  it('gives every seeded product a unique, valid EAN-13', async () => {
    const app = await makeApp({ approve: false });
    const { rows } = await app.call('products:list', {});
    expect(rows).toHaveLength(114);
    const codes = rows.map((r: any) => r.barcode);
    expect(codes.every((c: string) => isValidEan13(c) && c.startsWith('2'))).toBe(true);
    expect(new Set(codes).size).toBe(114);
  });

  it('assigns barcodes to new products and keeps a hand-entered manufacturer code', async () => {
    const app = await makeApp();
    const cats = await app.call('categories:list');
    const base = { nameEn: 'New cracker', nameTa: '', categoryId: cats[0].id, unit: 'Box', pricePaise: 5000, discountRule: 'inherit', minStock: 0, active: true };
    const auto = await app.call('products:create', base);
    expect(isValidEan13(auto.barcode)).toBe(true);
    const manual = await app.call('products:create', { ...base, nameEn: 'Branded', barcode: '4006381333931' });
    expect(manual.barcode).toBe('4006381333931');
    // a non-EAN carton code is accepted for lookup
    const carton = await app.call('products:create', { ...base, nameEn: 'Carton', barcode: 'CTN-0001' });
    expect(carton.barcode).toBe('CTN-0001');
    await expectError(app.call('products:create', { ...base, nameEn: 'Typo', barcode: '4006381333932' }), 'VALIDATION', 'check digit');
    await expectError(app.call('products:create', { ...base, nameEn: 'Dupe', barcode: '4006381333931' }), 'CONFLICT', 'barcode');
    await expectError(app.call('products:create', { ...base, nameEn: 'Bad chars', barcode: 'ab cd' }), 'VALIDATION');
  });

  it('never changes an existing barcode when a product is edited with the field blank', async () => {
    const app = await makeApp();
    const p = await product(app, 'SK-045');
    const data = { nameEn: p.nameEn, nameTa: p.nameTa, categoryId: p.categoryId, unit: p.unit, pricePaise: p.pricePaise, minStock: 0, discountRule: 'inherit', active: true, barcode: '' };
    expect((await app.call('products:update', { id: p.id, data })).barcode).toBe(p.barcode);
    const changed = await app.call('products:update', { id: p.id, data: { ...data, barcode: '5901234123457' } });
    expect(changed.barcode).toBe('5901234123457');
    const log = (await app.call('audit:list', { action: 'product.update' })).rows;
    expect(JSON.parse(log[0].details).barcode).toEqual({ from: p.barcode, to: '5901234123457' });
  });

  it('finds products by scanned barcode, including inactive ones (so the UI can explain)', async () => {
    const app = await makeApp();
    const p = await product(app, 'SK-043');
    expect((await app.call('products:byCode', { code: p.barcode })).sku).toBe('SK-043');
    expect(await app.call('products:byCode', { code: '2999999999994' })).toBeNull();
    await app.call('products:setActive', { id: p.id, active: false });
    expect((await app.call('products:byCode', { code: p.barcode })).active).toBe(false);
    expect((await app.call('products:list', { search: p.barcode })).rows.map((r: any) => r.sku)).toEqual(['SK-043']);
  });

  it('a scanned barcode can be billed end to end', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-043', 5);
    const found = await app.call('products:byCode', { code: p.barcode });
    const inv = await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: found.id, qty: 1 }], payments: [{ mode: 'cash', amountPaise: 9000 }] });
    expect(inv.lines[0].sku).toBe('SK-043');
  });

  it('CSV import creates barcodes for new products, validates supplied ones and keeps existing codes', async () => {
    const app = await makeApp({ approve: false });
    const before = (await product(app, 'SK-001')).barcode;
    const csv = ['sku,barcode,name_en,name_ta,category,unit,price', 'SK-001,,7 cm Green,7 cm கீரின்,Sparklers,Box,18.00', 'NEW-1,,Fresh item,,Fancy Items,Box,12.00', 'NEW-2,4006381333931,Branded item,,Fancy Items,Box,12.00', 'NEW-3,4006381333930,Bad code,,Fancy Items,Box,12.00'].join('\n');
    const prev = await app.call('catalogue:importPreview', { text: csv });
    expect(prev.rows.find((r: any) => r.sku === 'NEW-3').action).toBe('error');
    await app.call('catalogue:importCommit', { text: csv, acceptWarnings: true });
    expect((await product(app, 'SK-001')).barcode).toBe(before);
    expect(isValidEan13((await product(app, 'NEW-1')).barcode)).toBe(true);
    expect((await product(app, 'NEW-2')).barcode).toBe('4006381333931');
  });
});

describe('upgrading a database that predates barcodes', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skbilling-bc-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('backfills missing barcodes on start-up and leaves existing ones untouched', async () => {
    const file = join(dir, 'old.sqlite');
    const rt1 = Runtime.open({ dbPath: file, backupDir: join(dir, 'b') });
    const first = rt1.db.prepare('SELECT id, barcode FROM products ORDER BY id LIMIT 3').all() as { id: number; barcode: string }[];
    // simulate an older database: wipe barcodes on all but the first product
    rt1.db.prepare('UPDATE products SET barcode = NULL WHERE id <> ?').run(first[0].id);
    rt1.close();
    const rt2 = Runtime.open({ dbPath: file, backupDir: join(dir, 'b') });
    const rows = rt2.db.prepare('SELECT id, barcode FROM products ORDER BY id').all() as { id: number; barcode: string }[];
    expect(rows).toHaveLength(114);
    expect(rows[0].barcode).toBe(first[0].barcode);
    expect(new Set(rows.map((r) => r.barcode)).size).toBe(114);
    expect(rows.every((r) => isValidEan13(r.barcode))).toBe(true);
    expect(ensureBarcodes(rt2.db, new Date())).toBe(0); // idempotent
    const log = rt2.db.prepare("SELECT details FROM audit_logs WHERE action = 'barcode.assign' ORDER BY id DESC LIMIT 1").get() as { details: string };
    expect(JSON.parse(log.details).count).toBe(113);
    void dispatch;
    rt2.close();
  });

  it('upgrades a v1 database straight through to barcodes', () => {
    const file = join(dir, 'v1.sqlite');
    const db = openDatabase(file);
    migrate(db, { migrations: MIGRATIONS.slice(0, 1) });
    db.prepare("INSERT INTO roles (name, label) VALUES ('owner','Owner')").run();
    db.prepare("INSERT INTO categories (name_en, created_at, updated_at) VALUES ('Cat','t','t')").run();
    db.prepare("INSERT INTO products (sku, name_en, category_id, unit, price_paise, created_at, updated_at) VALUES ('OLD-1','Old',1,'Box',100,'t','t')").run();
    db.close();
    const rt = Runtime.open({ dbPath: file, backupDir: join(dir, 'b') });
    const row = rt.db.prepare("SELECT barcode FROM products WHERE sku='OLD-1'").get() as { barcode: string };
    expect(isValidEan13(row.barcode)).toBe(true);
    rt.close();
  });
});

describe('barcode labels', () => {
  const item = (n: number, barcode: string | null = '2000000000015') => ({ sku: `SK-${n}`, nameEn: `Item ${n}`, nameTa: 'கிளாசிக் பாம்', unit: 'Box', pricePaise: 15000, barcode });

  it('renders one page per thermal label with name, Tamil name, price and bars', () => {
    const r = renderLabelsHtml([item(1), item(2), item(2)], 'Sri Krishna Pattasu Kadai', DEFAULT_LABEL_LAYOUT, { fontBase: './fonts' });
    expect(r.labels).toBe(3);
    expect(r.pages).toBe(3);
    expect(r.html).toContain('@page{size:50mm 30mm;margin:0}');
    expect(r.html).toContain('கிளாசிக் பாம்');
    expect(r.html).toContain('₹150.00');
    expect(r.html).toContain('aria-label="Barcode 2000000000015"');
    expect(r.html).toContain('Sri Krishna Pattasu Kadai');
    expect(r.moduleMm).toBeGreaterThan(0.25); // scannable bar width on a 50 x 30 label
    expect(r.html.match(/class="lb"/g)).toHaveLength(3);
  });

  it('lays out A4 sheets as a grid and can skip used positions', () => {
    const layout = { ...DEFAULT_LABEL_LAYOUT, kind: 'a4' as const, cols: 3, rows: 8, marginTopMm: 10, marginLeftMm: 7, gapMm: 0 };
    const g = labelGeometry(layout);
    expect(g.perPage).toBe(24);
    expect(g.labelWidthMm).toBeCloseTo(65.33, 1);
    expect(g.labelHeightMm).toBeCloseTo(34.625, 2);
    const many = Array.from({ length: 30 }, (_, i) => item(i));
    expect(renderLabelsHtml(many, 'Shop', layout, { fontBase: '.' }).pages).toBe(2);
    const skipped = renderLabelsHtml(many.slice(0, 22), 'Shop', layout, { fontBase: '.', startAt: 5 });
    expect(skipped.pages).toBe(2); // 5 blanks + 22 labels = 27 cells
    expect(skipped.html.match(/class="blank"/g)).toHaveLength(5);
    expect(skipped.labels).toBe(22);
  });

  it('skips products without a drawable barcode and says why', () => {
    const r = renderLabelsHtml([item(1, null), item(2, 'CTN-0001'), item(3)], 'Shop', DEFAULT_LABEL_LAYOUT, { fontBase: '.' });
    expect(r.labels).toBe(1);
    expect(r.skipped.map((s) => s.reason)).toEqual(['no barcode', '"CTN-0001" is not an EAN-13, so it cannot be drawn']);
  });

  it('escapes product names', () => {
    const r = renderLabelsHtml([{ ...item(1), nameEn: '<img src=x onerror=alert(1)>' }], 'Shop', DEFAULT_LABEL_LAYOUT, { fontBase: '.' });
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('&lt;img src=x');
  });

  it('serves label html through the API with copies, validation and saved layout', async () => {
    const app = await makeApp();
    const a = await product(app, 'SK-045');
    const b = await product(app, 'SK-046');
    const r = await app.call('labels:html', { items: [{ productId: a.id, copies: 2 }, { productId: b.id, copies: 1 }] });
    expect(r.labels).toBe(3);
    expect(r.html).toContain(a.barcode);
    expect(r.html).toContain(b.barcode);
    await app.call('settings:update', { patch: { 'labels.layout': { ...DEFAULT_LABEL_LAYOUT, kind: 'a4', cols: 4, rows: 10, showTamil: false } } });
    const a4 = await app.call('labels:html', { items: [{ productId: a.id, copies: 50 }] });
    expect(a4.pages).toBe(2);
    expect(a4.geometry.perPage).toBe(40);
    expect(a4.html).not.toContain('கிளாசிக்');
    await expectError(app.call('labels:html', { items: [{ productId: a.id, copies: 501 }] }), 'VALIDATION');
    await expectError(app.call('labels:html', { items: [{ productId: 99999, copies: 1 }] }), 'NOT_FOUND');
    await expectError(app.call('settings:update', { patch: { 'labels.layout': { ...DEFAULT_LABEL_LAYOUT, widthMm: 5 } } }), 'VALIDATION');
    const big = { items: Array.from({ length: 11 }, (_, i) => ({ productId: a.id + i, copies: 500 })) };
    await expectError(app.call('labels:html', big), 'VALIDATION', '5000');
  });
});
