import { describe, expect, it } from 'vitest';
import { makeApp, setStock, rid, expectError } from './helpers';
import { renderInvoiceHtml, sampleInvoice, esc } from '../src/shared/invoiceHtml';
import { shopForPrint, recordInvoicePrint, buildInvoiceHtml } from '../src/core/api';

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

  it('prints English and Tamil shop and item names, totals and ₹ amounts on every paper size', async () => {
    const { app, inv } = await oneBill();
    for (const size of ['58mm', '80mm', 'a4'] as const) {
      const html = renderInvoiceHtml(inv, shopForPrint(app.rt), { size, fontBase: './fonts' });
      expect(html).toContain('Sri Krishna Pattasu Kadai');
      expect(html).toContain('ஸ்ரீ கிருஷ்ணா பட்டாசு கடை');
      expect(html).toContain('கிளாசிக் பாம்');
      expect(html).toContain(inv.invoiceNo);
      expect(html).toContain('₹270.00'); // net payable 2 x 150 less 10%
      expect(html).toContain('Noto Sans Tamil');
      expect(html).toContain('./fonts/fonts.css');
      expect(html).toMatch(size === 'a4' ? /@page\{size:A4/ : new RegExp(`@page\\{size:${size} auto`));
    }
  });

  it('can hide Tamil, marks cancelled bills, drafts and test pages', async () => {
    const { app, inv } = await oneBill();
    const shop = { ...shopForPrint(app.rt), showTamil: false };
    expect(renderInvoiceHtml(inv, shop, { size: '80mm', fontBase: '.' })).not.toContain('கிளாசிக் பாம்');
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
