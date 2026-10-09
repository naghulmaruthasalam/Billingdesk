import { describe, expect, it } from 'vitest';
import { makeApp, product, expectError } from './helpers';
import { SEED_PRODUCTS, SEED_CATEGORIES } from '../src/shared/catalogue';

describe('seeded catalogue', () => {
  it('contains every printed entry in print order with printed rates', async () => {
    const app = await makeApp({ approve: false });
    const { rows, total } = await app.call('products:list', {});
    expect(total).toBe(114);
    expect(SEED_PRODUCTS).toHaveLength(114);
    expect(rows.map((r: any) => r.printedNo).slice(15, 20)).toEqual([16, 17, 18, 114, 19]);
    for (const s of SEED_PRODUCTS) {
      const p = rows.find((r: any) => r.printedNo === s.no);
      expect(p, `S.No ${s.no}`).toBeTruthy();
      expect(p.pricePaise).toBe(s.rate * 100);
      expect(p.printedPricePaise).toBe(s.rate * 100);
      expect(p.nameEn).toBe(s.en);
    }
    const cats = await app.call('categories:list');
    expect(cats).toHaveLength(SEED_CATEGORIES.length);
    expect(cats.map((c: any) => c.nameEn)).toContain('Gaint & Deluxe Crackers');
  });

  it('spot-checks rates against the photographed list', async () => {
    const app = await makeApp({ approve: false });
    const price = async (no: number) => (await app.call('products:list', { search: `#${no}` })).rows[0].pricePaise / 100;
    expect(await price(1)).toBe(16);
    expect(await price(15)).toBe(250);
    expect(await price(34)).toBe(20); // 3½ Lakshmi (not 3¾)
    expect(await price(65)).toBe(4400);
    expect(await price(77)).toBe(650);
    expect(await price(83)).toBe(4200);
    expect(await price(97)).toBe(170);
    expect(await price(113)).toBe(1300);
    expect(await price(114)).toBe(60);
  });

  it('does not invent stock, cost or tax', async () => {
    const app = await makeApp({ approve: false });
    const { rows } = await app.call('products:list', {});
    expect(rows.every((r: any) => r.stockQty === 0 && r.costPaise === null)).toBe(true);
    const s = await app.call('settings:get');
    expect(s['tax.enabled']).toBe(false);
    expect(s['shop.tax_id']).toBe('');
  });

  it('starts with uncertain entries flagged and billing disabled until the owner approves', async () => {
    const app = await makeApp({ approve: false });
    const st = await app.call('catalogue:status');
    expect(st.needsReview).toBeGreaterThan(5);
    expect(st.approved).toBe(false);
    await expectError(app.call('catalogue:approve', { approved: true }), 'VALIDATION', 'still marked for review');
    const flagged = (await app.call('products:list', { reviewOnly: true })).rows;
    // The row printed as 114 and blank-unit rows must be flagged, never silently "corrected".
    expect(flagged.some((r: any) => r.printedNo === 114)).toBe(true);
    expect(flagged.some((r: any) => r.printedNo === 15)).toBe(true);
    await app.call('catalogue:markReviewed', { ids: flagged.map((r: any) => r.id) });
    const after = await app.call('catalogue:approve', { approved: true });
    expect(after.approved).toBe(true);
  });

  it('marks gift boxes non-discountable and everything else eligible by default', async () => {
    const app = await makeApp();
    const gift = await product(app, 'SK-110');
    const sparkler = await product(app, 'SK-001');
    expect(gift.effectiveDiscountBp).toBe(0);
    expect(sparkler.effectiveDiscountBp).toBe(1000);
  });
});

describe('product search', () => {
  it('finds by English name, case-insensitively and by partial tokens', async () => {
    const app = await makeApp({ approve: false });
    const r = await app.call('products:list', { search: '10 cm col' });
    expect(r.rows.map((p: any) => p.nameEn)).toContain('10 cm Colour');
    expect(r.rows.every((p: any) => /10 cm/i.test(p.nameEn) || /col/i.test(p.nameEn))).toBe(true);
    const r2 = await app.call('products:list', { search: 'HYDROGEN' });
    expect(r2.rows.map((p: any) => p.sku)).toEqual(['SK-043']);
  });
  it('finds by Tamil text', async () => {
    const app = await makeApp({ approve: false });
    const r = await app.call('products:list', { search: 'லட்சுமி' });
    expect(r.rows.map((p: any) => p.nameEn)).toEqual(expect.arrayContaining(['3½ Lakshmi', '4" Lakshmi', '4" Gold Lakshmi']));
    const r2 = await app.call('products:list', { search: 'பாம்' });
    expect(r2.rows.length).toBeGreaterThan(8);
    const r3 = await app.call('products:list', { search: 'கலர் பைப்' });
    expect(r3.rows).toHaveLength(4);
  });
  it('matches the Tamil category name too', async () => {
    const app = await makeApp({ approve: false });
    const r = await app.call('products:list', { search: 'பூந்தொட்டி' });
    expect(r.rows.length).toBe(9);
  });
  it('finds by SKU, printed serial number and barcode', async () => {
    const app = await makeApp({ approve: false });
    expect((await app.call('products:list', { search: 'sk-046' })).rows[0].nameEn).toBe('555 Bomb');
    expect((await app.call('products:list', { search: '#46' })).rows).toHaveLength(1);
    const cats = await app.call('categories:list');
    const created = await app.call('products:create', { nameEn: 'Barcoded', nameTa: '', categoryId: cats[0].id, unit: 'Box', pricePaise: 1000, barcode: '8901234567890', discountRule: 'inherit', minStock: 0, active: true });
    expect((await app.call('products:byCode', { code: '8901234567890' })).id).toBe(created.id);
  });
  it('treats wildcard characters literally', async () => {
    const app = await makeApp({ approve: false });
    expect((await app.call('products:list', { search: '%' })).rows).toHaveLength(0);
    expect((await app.call('products:list', { search: "x'; DROP TABLE products;--" })).rows).toHaveLength(0);
    expect((await app.call('products:list', {})).total).toBe(114);
  });
});

describe('catalogue CSV import and export', () => {
  it('round-trips the catalogue as unchanged rows', async () => {
    const app = await makeApp({ approve: false });
    const { text } = await app.call('catalogue:export');
    const prev = await app.call('catalogue:importPreview', { text });
    expect(prev.summary.total).toBe(114);
    expect(prev.summary.errors).toBe(0);
    expect(prev.summary.unchanged).toBe(114);
  });

  it('previews duplicates, missing and invalid prices, and uncertain names before committing', async () => {
    const app = await makeApp({ approve: false });
    const csv = [
      'sku,name_en,name_ta,category,unit,price,discount_rule',
      'SK-001,7 cm Green,7 cm கீரின்,Sparklers,Box,18.00,inherit', // price update
      'NEW-1,New Item,புதிய,Fancy Items,Box,,inherit', // missing price
      'NEW-1,Duplicate Sku,x,Fancy Items,Box,10,inherit', // duplicate sku in file
      'NEW-2,Bad Price,x,Fancy Items,Box,abc,inherit', // invalid price
      'NEW-3,Wh?t is this,x,Fancy Items,Box,50,inherit', // uncertain name
      'NEW-4,Odd Rule,x,Fancy Items,Box,50,sometimes', // invalid rule
      'NEW-5,Brand New Cat,x,Mystery Category,Box,50,inherit', // new category
      'SK-002,,x,Sparklers,Box,25,inherit', // missing name
    ].join('\n');
    const prev = await app.call('catalogue:importPreview', { text: csv });
    const by = (sku: string, i = 0) => prev.rows.filter((r: any) => r.sku === sku)[i];
    expect(by('SK-001').action).toBe('update');
    expect(by('SK-001').changes).toEqual([{ field: 'price', from: '16.00', to: '18.00' }]);
    expect(by('NEW-1').action).toBe('create');
    expect(by('NEW-1').issues.map((i: any) => i.message).join()).toMatch(/Price is missing/);
    expect(by('NEW-1', 1).action).toBe('error');
    expect(by('NEW-2').action).toBe('error');
    expect(by('NEW-3').uncertain).toBe(true);
    expect(by('NEW-4').action).toBe('error');
    expect(prev.newCategories).toContain('Mystery Category');
    expect(by('SK-002').action).toBe('error');
    expect(prev.summary.errors).toBe(4);
    expect(prev.summary.missingPrice).toBeGreaterThanOrEqual(1);
    // nothing was committed by previewing
    expect((await app.call('products:list', {})).total).toBe(114);
  });

  it('refuses to commit warnings that were not accepted, and skips error rows', async () => {
    const app = await makeApp({ approve: false });
    const csv = 'sku,name_en,name_ta,category,unit,price\nSK-001,7 cm Green,7 cm கீரின்,Sparklers,Box,18.00\nBAD,Bad,x,Sparklers,Box,zzz\nNEW-9,Fresh,,Fancy Items,Box,12.00';
    await expectError(app.call('catalogue:importCommit', { text: csv, acceptWarnings: false }), 'VALIDATION', 'warnings');
    const r = await app.call('catalogue:importCommit', { text: csv, acceptWarnings: true });
    expect(r).toEqual({ created: 1, updated: 1, skipped: 1 });
    expect((await product(app, 'SK-001')).pricePaise).toBe(1800);
    expect((await product(app, 'SK-001')).printedPricePaise).toBe(1600); // the printed rate is preserved
    const audit = await app.call('audit:list', { action: 'product.price_change' });
    expect(audit.rows.length).toBe(1);
  });

  it('resets the catalogue to the printed list without touching stock', async () => {
    const app = await makeApp();
    const p = await product(app, 'SK-003');
    await app.call('products:update', { id: p.id, data: { nameEn: 'Changed', nameTa: '', categoryId: p.categoryId, unit: 'Box', pricePaise: 9999, minStock: 0, discountRule: 'never', active: false } });
    await app.call('inventory:setOpening', { rows: [{ productId: p.id, qty: 7 }] });
    await app.call('catalogue:reset', { confirmPassword: 'owner-pass-1' });
    const after = await product(app, 'SK-003');
    expect(after.nameEn).toBe('10 cm Colour');
    expect(after.pricePaise).toBe(3500);
    expect(after.stockQty).toBe(7);
    expect((await app.call('catalogue:status')).approved).toBe(false);
    await expectError(app.call('catalogue:reset', { confirmPassword: 'wrong' }), 'FORBIDDEN');
  });
});

describe('product maintenance', () => {
  it('audits price changes and rejects duplicate SKUs', async () => {
    const app = await makeApp();
    const p = await product(app, 'SK-002');
    const data = { nameEn: p.nameEn, nameTa: p.nameTa, categoryId: p.categoryId, unit: p.unit, pricePaise: 2700, minStock: 0, discountRule: 'inherit', active: true };
    await app.call('products:update', { id: p.id, data });
    const log = (await app.call('audit:list', { action: 'product.price_change' })).rows;
    expect(JSON.parse(log[0].details).pricePaise).toEqual({ from: 2500, to: 2700 });
    await expectError(app.call('products:update', { id: p.id, data: { ...data, sku: 'SK-003' } }), 'CONFLICT', 'SKU');
  });
  it('cannot sell a product without a price', async () => {
    const app = await makeApp();
    const cats = await app.call('categories:list');
    const np = await app.call('products:create', { nameEn: 'No price', nameTa: '', categoryId: cats[0].id, unit: 'Box', pricePaise: null, discountRule: 'inherit', minStock: 0, active: true, openingStock: 5 });
    await expectError(app.call('catalogue:approve', { approved: true }), 'VALIDATION', 'no price');
    await app.call('products:setActive', { id: np.id, active: false });
    await app.call('catalogue:approve', { approved: true });
  });
});
