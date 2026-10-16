import { describe, expect, it } from 'vitest';
import { makeApp, setStock, rid, expectError } from './helpers';
import { renderInvoiceHtml, sampleInvoice, esc } from '../src/shared/invoiceHtml';
import { shopForPrint, recordInvoicePrint, buildInvoiceHtml } from '../src/core/api';
import { ensureSeeded } from '../src/core/seed';
import { getSetting, SETTING_DEFAULTS } from '../src/core/settings';

async function oneBill() {
  const app = await makeApp();
  const p = await setStock(app, 'SK-045', 5);
  const inv = await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 2 }], payments: [{ mode: 'cash', amountPaise: 30000 }] });
  return { app, inv };
}

describe('invoice rendering', () => {
  it('escapes HTML in names so a product name cannot inject markup', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('prints English-only shop and item names, totals and ₹ amounts on every paper size by default', async () => {
    const { app, inv } = await oneBill();
    for (const size of ['58mm', '80mm', 'a4'] as const) {
      const html = renderInvoiceHtml(inv, shopForPrint(app.rt), { size, fontBase: './fonts' });
      expect(html).toContain('Sree Krishna Crackers Shop');
      expect(html).toContain('Classic Bomb');
      expect(html).not.toContain('ஸ்ரீ கிருஷ்ணா பட்டாசு கடை');
      expect(html).not.toContain('கிளாசிக் பாம்');
      expect(html).toContain(inv.invoiceNo);
      expect(html).toContain('₹270.00'); // net payable 2 x 150 less 10%
      expect(html).toContain('./fonts/fonts.css');
      expect(html).toMatch(size === 'a4' ? /@page\{size:A4/ : new RegExp(`@page\\{size:${size} auto`));
    }
  });

  it('lists items at list price and gives the discount once, on the total bill', async () => {
    const { app, inv } = await oneBill();
    for (const size of ['58mm', '80mm', 'a4'] as const) {
      const html = renderInvoiceHtml(inv, shopForPrint(app.rt), { size, fontBase: '.' });
      expect(html).toContain('Discount (10%)'); // the rate, beside the amount
      expect(html).not.toMatch(/<th[^>]*>Discount/); // no per-item discount column
      const rows = html.match(/<tr><td[^>]*>.*?<\/tr>/g) ?? [];
      expect(rows.join('')).toContain('300.00'); // 2 x 150.00 before discount
      expect(rows.join('')).not.toContain('270.00'); // net only appears in the totals
      expect(html).toContain('₹270.00');
    }
  });

  it('lays the item rows out as item, price, qty, total in fixed columns', async () => {
    const { app, inv } = await oneBill();
    for (const size of ['58mm', '80mm'] as const) {
      const html = renderInvoiceHtml(inv, shopForPrint(app.rt), { size, fontBase: '.' });
      expect(html).toMatch(/<th>Item<\/th><th>Price<\/th><th class="q">Qty<\/th><th>Total<\/th>/);
      expect(html).toContain('table-layout:fixed');
      const row = html.match(/<tr><td class="n">.*?<\/tr>/)![0];
      expect(row.indexOf('150.00')).toBeLessThan(row.indexOf('>2<')); // price before qty
      expect(row.indexOf('>2<')).toBeLessThan(row.indexOf('300.00')); // qty before total
    }
    const a4 = renderInvoiceHtml(inv, shopForPrint(app.rt), { size: 'a4', fontBase: '.' });
    expect(a4).toMatch(/<th>Item<\/th><th class="r">Price[^<]*<\/th><th class="r">Qty<\/th><th class="r">Total/);
  });

  it('shows just "Paid - <method>" with the amount, without repeating the cash tendered', async () => {
    const { app, inv } = await oneBill();
    const html = renderInvoiceHtml({ ...inv, payments: [{ kind: 'sale', mode: 'cash', amountPaise: 27000, tenderedPaise: 50000 }], changePaise: 23000 }, shopForPrint(app.rt), { size: '80mm', fontBase: '.' });
    expect(html).toContain('Paid - Cash');
    expect(html).not.toContain('tendered');
    expect(html).not.toContain('500.00');
    expect(html).toContain('Change returned');
  });

  it('shows the total quantity beside the total, the no-return tagline and the greeting', async () => {
    const { app, inv } = await oneBill();
    for (const size of ['58mm', '80mm', 'a4'] as const) {
      const html = renderInvoiceHtml(inv, shopForPrint(app.rt), { size, fontBase: '.' });
      expect(html).toContain('Total qty: 2'); // 2 x Classic Bomb
      expect(html.indexOf('Net payable')).toBeLessThan(html.indexOf('Total qty'));
      expect(html.indexOf('Total qty')).toBeLessThan(html.indexOf('Goods once sold')); // directly above the tagline
      expect(html).toContain('Goods once sold cannot be taken back.');
      expect(html).toContain('Wishing you a Happy Diwali 🎆');
      expect(html.lastIndexOf('Happy Diwali')).toBeGreaterThan(html.indexOf('Goods once sold'));
      expect(html).not.toContain('Kovaipudur');
    }
  });

  it('prints the address on two lines exactly as set, and upgrades an untouched older default', async () => {
    const { app, inv } = await oneBill();
    const html = renderInvoiceHtml(inv, shopForPrint(app.rt), { size: '80mm', fontBase: '.' });
    expect(html).toContain('4/210, J.V. Complex, Kurunthachalam Nagar,\nN.G.G.O. Colony Main Road, Coimbatore - 641017.');
    expect(html).toContain('.addr{white-space:pre-line');
    expect(html).not.toContain('Kovaipudur');
    // a database still holding an earlier shipped default (never edited) is moved to the current one; edited values are left alone
    const legacy = '4/210, J.V. Complex, Gurunthasala Nagar, N.G.G.O. Colony Main Road, Kovaipudur, Coimbatore - 641017.';
    await app.call('settings:update', { patch: { 'shop.address': legacy } });
    ensureSeeded(app.rt.db, new Date());
    expect(getSetting(app.rt.db, 'shop.address')).toBe(SETTING_DEFAULTS['shop.address']);
    await app.call('settings:update', { patch: { 'invoice.greeting': 'Happy Diwali 🎆' } });
    ensureSeeded(app.rt.db, new Date());
    expect(getSetting(app.rt.db, 'invoice.greeting')).toBe('Wishing you a Happy Diwali 🎆');
    // earlier shop-name defaults are upgraded too; a name the owner typed is kept
    await app.call('settings:update', { patch: { 'shop.name_en': 'Shree Krishna Crackers Shop' } });
    ensureSeeded(app.rt.db, new Date());
    expect(getSetting(app.rt.db, 'shop.name_en')).toBe('Sree Krishna Crackers Shop');
    await app.call('settings:update', { patch: { 'shop.name_en': 'My Shop' } });
    ensureSeeded(app.rt.db, new Date());
    expect(getSetting(app.rt.db, 'shop.name_en')).toBe('My Shop');
    await app.call('settings:update', { patch: { 'shop.address': 'My own address' } });
    ensureSeeded(app.rt.db, new Date());
    expect(getSetting(app.rt.db, 'shop.address')).toBe('My own address');
  });

  it('can optionally add Tamil, marks cancelled bills, drafts and test pages', async () => {
    const { app, inv } = await oneBill();
    const shop = { ...shopForPrint(app.rt), showTamil: true };
    expect(renderInvoiceHtml(inv, shop, { size: '80mm', fontBase: '.' })).toContain('கிளாசிக் பாம்');
    expect(renderInvoiceHtml({ ...inv, status: 'cancelled', cancelReason: 'x' }, shopForPrint(app.rt), { size: '80mm', fontBase: '.' })).toContain('CANCELLED');
    expect(renderInvoiceHtml({ ...inv, draft: true }, shopForPrint(app.rt), { size: '80mm', fontBase: '.' })).toContain('DRAFT PREVIEW');
    expect(renderInvoiceHtml(sampleInvoice(), shopForPrint(app.rt), { size: '80mm', fontBase: '.' })).toContain('SAMPLE - TEST PRINT');
  });

  it('shows tax lines only when tax is configured', async () => {
    const app = await makeApp();
    await app.call('settings:update', { patch: { 'tax.enabled': true, 'tax.rate_bp': 1800, 'tax.label': 'GST' } });
    const p = await setStock(app, 'SK-045', 5);
    const inv = await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 1 }], payments: [{ mode: 'cash', amountPaise: 20000 }] });
    expect(renderInvoiceHtml(inv, shopForPrint(app.rt), { size: 'a4', fontBase: '.' })).toContain('GST 18%');
  });
});

describe('print gating', () => {
  it('disables printing until the owner confirms the transcribed address, and re-locks when it is edited', async () => {
    const { app, inv } = await oneBill();
    await expectError(app.call('invoice:html', { id: inv.id }), 'SETUP_INCOMPLETE', 'confirms');
    await app.call('settings:confirmAddress');
    expect((await app.call('invoice:html', { id: inv.id })).html).toContain(inv.invoiceNo);
    await app.call('settings:update', { patch: { 'shop.address': '4/210, J.V. Complex, Gurunthachala Nagar, Kovaipudur, Coimbatore - 641017' } });
    await expectError(app.call('invoice:html', { id: inv.id }), 'SETUP_INCOMPLETE');
    await app.call('settings:confirmAddress');
    expect((await app.call('invoice:html', { id: inv.id })).html).toContain('Gurunthachala');
  });

  it('marks DUPLICATE COPY only after the original has been printed once', async () => {
    const { app, inv } = await oneBill();
    await app.call('settings:confirmAddress');
    expect((await app.call('invoice:html', { id: inv.id })).html).not.toContain('DUPLICATE COPY');
    recordInvoicePrint(app.rt.ctx(), inv.id, 'print');
    expect((await app.call('invoice:html', { id: inv.id })).html).toContain('DUPLICATE COPY');
    void buildInvoiceHtml;
  });

  it('refuses invoice html to users without the reprint permission', async () => {
    const { app, inv } = await oneBill();
    await app.call('settings:confirmAddress');
    const roles = await app.call('roles:list');
    await app.call('users:create', { username: 'inv', displayName: 'inv', password: 'pass-1234', roleId: roles.find((r: any) => r.name === 'inventory_manager').id });
    await app.call('auth:login', { username: 'inv', password: 'pass-1234' });
    await expectError(app.call('invoice:html', { id: inv.id }), 'FORBIDDEN');
  });
});
