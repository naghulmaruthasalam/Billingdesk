import { describe, expect, it } from 'vitest';
import { makeApp, product, setStock, rid, expectError, addUser, loginAs, OWNER } from './helpers';

async function bill(app: any, lines: any[], payments: any[], extra: any = {}) {
  return app.call('billing:create', { clientRequestId: rid(), lines, payments, ...extra });
}

describe('POS billing', () => {
  it('refuses to bill until the owner approves the catalogue', async () => {
    const app = await makeApp({ approve: false });
    const p = await product(app, 'SK-001');
    await expectError(bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 5000 }]), 'SETUP_INCOMPLETE', 'catalogue');
  });

  it('creates a multi-product bill with discounts on eligible products only', async () => {
    const app = await makeApp();
    const spark = await setStock(app, 'SK-009', 20); // 15 cm Green Rs 65
    const bomb = await setStock(app, 'SK-045', 10); // Classic Bomb Rs 150
    const gift = await setStock(app, 'SK-110', 5); // 20 Items Rs 450 - NO DISCOUNT
    const inv = await bill(
      app,
      [
        { productId: spark.id, qty: 3 },
        { productId: bomb.id, qty: 2 },
        { productId: gift.id, qty: 1 },
      ],
      [{ mode: 'cash', amountPaise: 100000 }],
    );
    // gross: 195 + 300 + 450 = 945.00 ; discount: 19.50 + 30.00 = 49.50 ; total 895.50
    expect(inv.subtotalPaise).toBe(94500);
    expect(inv.discountPaise).toBe(4950);
    expect(inv.totalPaise).toBe(89550);
    expect(inv.lines.map((l: any) => [l.discountBp, l.discountSource])).toEqual([[1000, 'policy'], [1000, 'policy'], [0, 'none']]);
    expect(inv.lines[0]).toMatchObject({ ratePaise: 6500, grossPaise: 19500, discountPaise: 1950, netPaise: 17550, sku: 'SK-009', nameTa: '15 cm கீரின்' });
    expect(inv.changePaise).toBe(100000 - 89550);
    expect(inv.paymentStatus).toBe('paid');
    expect(inv.invoiceNo).toBe('SKP-000001');
  });

  it('records cash change and UPI payments, and deducts stock exactly once', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-043', 10); // Hydrogen Bomb Rs 90
    const cash = await bill(app, [{ productId: p.id, qty: 2 }], [{ mode: 'cash', amountPaise: 20000 }]);
    expect(cash.totalPaise).toBe(16200);
    expect(cash.changePaise).toBe(3800);
    expect(cash.payments).toHaveLength(1);
    expect(cash.payments[0]).toMatchObject({ mode: 'cash', amountPaise: 16200, tenderedPaise: 20000 });
    const upi = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'upi', amountPaise: 8100, reference: 'UTR-42' }]);
    expect(upi.payments[0]).toMatchObject({ mode: 'upi', amountPaise: 8100, reference: 'UTR-42' });
    expect((await product(app, 'SK-043')).stockQty).toBe(7);
    const mv = (await app.call('inventory:movements', { productId: p.id })).rows.filter((m: any) => m.type === 'sale');
    expect(mv.map((m: any) => m.qtyDelta).sort((a: number, b: number) => a - b)).toEqual([-2, -1]);
    expect(mv.every((m: any) => m.reason.startsWith('Sale SKP-'))).toBe(true);
  });

  it('supports split payments', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-059', 3); // 1000 Wala Gold Rs 440
    const inv = await bill(app, [{ productId: p.id, qty: 2 }], [{ mode: 'upi', amountPaise: 50000 }, { mode: 'cash', amountPaise: 30000 }]);
    expect(inv.totalPaise).toBe(79200);
    expect(inv.payments.map((x: any) => [x.mode, x.amountPaise]).sort()).toEqual([['cash', 29200], ['upi', 50000]]);
    expect(inv.changePaise).toBe(800);
  });

  it('is idempotent: a repeated request creates one bill and one stock deduction', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 10);
    const key = rid();
    const payload = { clientRequestId: key, lines: [{ productId: p.id, qty: 4 }], payments: [{ mode: 'cash', amountPaise: 9000 }] };
    const a = await app.call('billing:create', payload);
    const b = await app.call('billing:create', payload);
    expect(b.id).toBe(a.id);
    expect(b.duplicate).toBe(true);
    expect((await product(app, 'SK-002')).stockQty).toBe(6);
    expect((await app.call('sales:list', {})).total).toBe(1);
  });

  it('numbers invoices sequentially with the configured prefix', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 10);
    const nos: string[] = [];
    for (let i = 0; i < 3; i++) nos.push((await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 3000 }])).invoiceNo);
    expect(nos).toEqual(['SKP-000001', 'SKP-000002', 'SKP-000003']);
    await app.call('settings:update', { patch: { 'invoice.prefix': 'KDI', 'invoice.pad': 4 } });
    expect((await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 3000 }])).invoiceNo).toBe('KDI-0004');
  });

  it('blocks sales beyond available stock and leaves no trace', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 2);
    const e = await expectError(bill(app, [{ productId: p.id, qty: 3 }], [{ mode: 'cash', amountPaise: 10000 }]), 'INSUFFICIENT_STOCK', 'have 2, need 3');
    expect((e.details as any).items[0]).toMatchObject({ available: 2, requested: 3 });
    expect((await app.call('sales:list', {})).total).toBe(0);
    expect((await product(app, 'SK-002')).stockQty).toBe(2);
    // two lines for the same product are summed for the check
    await expectError(bill(app, [{ productId: p.id, qty: 2 }, { productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 10000 }]), 'INSUFFICIENT_STOCK');
  });

  it('allows an authorised stock override and records it', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 1);
    const inv = await bill(app, [{ productId: p.id, qty: 3, stockOverride: true }], [{ mode: 'cash', amountPaise: 10000 }]);
    expect(inv.lines[0].stockOverride).toBe(true);
    expect((await product(app, 'SK-002')).stockQty).toBe(-2);
    const log = (await app.call('audit:list', { action: 'billing.stock_override' })).rows;
    expect(log).toHaveLength(1);
  });

  it('rolls back the whole bill if any step fails (invoice, payments, stock, counter)', async () => {
    const app = await makeApp();
    const a = await setStock(app, 'SK-002', 5);
    const b = await setStock(app, 'SK-003', 5);
    // Force a failure while the second line's stock movement is written.
    app.rt.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON inventory_movements WHEN NEW.movement_type='sale' AND NEW.product_id=${b.id} BEGIN SELECT RAISE(ABORT,'simulated failure'); END;`);
    await expect(app.raw('billing:create', { clientRequestId: rid(), lines: [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 1 }], payments: [{ mode: 'cash', amountPaise: 10000 }] })).resolves.toMatchObject({ ok: false });
    expect((await app.call('sales:list', {})).total).toBe(0);
    expect(app.rt.db.prepare('SELECT COUNT(*) c FROM payments').get()).toEqual({ c: 0 });
    expect((await product(app, 'SK-002')).stockQty).toBe(5);
    expect((await product(app, 'SK-003')).stockQty).toBe(5);
    app.rt.db.exec('DROP TRIGGER boom');
    // the invoice counter was not consumed by the failed attempt
    const ok = await bill(app, [{ productId: a.id, qty: 1 }], [{ mode: 'cash', amountPaise: 5000 }]);
    expect(ok.invoiceNo).toBe('SKP-000001');
  });

  it('rejects underpayment, inactive and unpriced products, and bad quantities', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 5);
    await expectError(bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 100 }]), 'VALIDATION', 'less than');
    await expectError(bill(app, [{ productId: p.id, qty: 0 }], [{ mode: 'cash', amountPaise: 5000 }]), 'VALIDATION');
    await expectError(bill(app, [{ productId: p.id, qty: 1.5 }], [{ mode: 'cash', amountPaise: 5000 }]), 'VALIDATION');
    await expectError(bill(app, [], [{ mode: 'cash', amountPaise: 5000 }]), 'VALIDATION', 'no items');
    await app.call('products:setActive', { id: p.id, active: false });
    await expectError(bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 5000 }]), 'VALIDATION', 'inactive');
  });

  it('applies the configured discount policy, category rules and rounding', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-012', 10); // 30 cm Green Rs 66.00
    await app.call('settings:update', { patch: { 'discount.default_bp': 500 } });
    let inv = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 10000 }]);
    expect(inv.discountPaise).toBe(330);
    // product-level non-discountable flag
    const full = await app.call('products:get', { id: p.id });
    await app.call('products:update', { id: p.id, data: { nameEn: full.nameEn, nameTa: full.nameTa, categoryId: full.categoryId, unit: full.unit, pricePaise: full.pricePaise, minStock: 0, discountRule: 'never', active: true } });
    inv = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 10000 }]);
    expect(inv.discountPaise).toBe(0);
    expect(inv.lines[0].discountSource).toBe('none');
    // rupee rounding at invoice level
    await app.call('products:update', { id: p.id, data: { nameEn: full.nameEn, nameTa: full.nameTa, categoryId: full.categoryId, unit: full.unit, pricePaise: full.pricePaise, minStock: 0, discountRule: 'inherit', active: true } });
    await app.call('settings:update', { patch: { 'discount.default_bp': 1000, 'discount.rounding_scope': 'invoice', 'discount.rounding_unit': 'rupee' } });
    inv = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 10000 }]); // 6.60 -> 7.00
    expect(inv.discountPaise).toBe(700);
    expect(inv.totalPaise).toBe(5900);
    expect(inv.discountRoundingPaise).toBe(40);
  });

  it('calculates exclusive tax when configured', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 5); // 150
    await app.call('settings:update', { patch: { 'tax.enabled': true, 'tax.rate_bp': 1800, 'tax.inclusive': false } });
    const inv = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 20000 }]);
    // net 135.00, tax 24.30
    expect(inv.taxPaise).toBe(2430);
    expect(inv.totalPaise).toBe(15930);
  });

  it('keeps completed invoices immutable at the database level', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 5);
    const inv = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 5000 }]);
    const db = app.rt.db;
    expect(() => db.prepare('UPDATE invoices SET total_paise = 1 WHERE id = ?').run(inv.id)).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id)).toThrow(/cannot be deleted/);
    expect(() => db.prepare('UPDATE invoice_lines SET qty = 9 WHERE invoice_id = ?').run(inv.id)).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM payments WHERE invoice_id = ?').run(inv.id)).toThrow(/cannot be deleted/);
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
    expect(() => db.prepare('UPDATE inventory_movements SET qty_delta = 0').run()).toThrow(/immutable/);
  });

  it('stores customer details and reuses a customer by phone', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 10);
    const a = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 5000 }], { customer: { name: 'Ravi', phone: '9876543210' } });
    const b = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 5000 }], { customer: { phone: '9876543210' } });
    expect(a.customerId).toBe(b.customerId);
    expect(b.customerName).toBe('Ravi');
    const list = await app.call('customers:list', { search: 'ravi' });
    expect(list.rows[0]).toMatchObject({ billCount: 2 });
  });
});

describe('discount overrides', () => {
  it('lets the owner override a discount with a reason and audits it; discounts never stack', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 5);
    await expectError(bill(app, [{ productId: p.id, qty: 1, discountOverrideBp: 2000 }], [{ mode: 'cash', amountPaise: 20000 }]), 'VALIDATION', 'reason');
    const inv = await bill(app, [{ productId: p.id, qty: 1, discountOverrideBp: 2000, overrideReason: 'Regular customer' }], [{ mode: 'cash', amountPaise: 20000 }]);
    expect(inv.lines[0]).toMatchObject({ discountBp: 2000, discountSource: 'override', discountPaise: 3000, netPaise: 12000 }); // 20% replaces 10%, total 20% not 30%
    const log = (await app.call('audit:list', { action: 'billing.discount_override' })).rows;
    expect(JSON.parse(log[0].details)).toMatchObject({ policyPercentBp: 1000, appliedBp: 2000, reason: 'Regular customer' });
  });

  it('requires supervisor credentials for a cashier and records both users', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 5);
    await addUser(app, 'asha', 'cashier');
    await loginAs(app, 'asha', 'pass-1234');
    const body = { productId: p.id, qty: 1, discountOverrideBp: 0, overrideReason: 'Price match' };
    const e = await expectError(bill(app, [body], [{ mode: 'cash', amountPaise: 20000 }]), 'FORBIDDEN', 'approval');
    expect((e.details as any).needsApproval).toBe(true);
    await expectError(bill(app, [body], [{ mode: 'cash', amountPaise: 20000 }], { approval: { username: 'owner', password: 'wrong' } }), 'FORBIDDEN');
    await expectError(bill(app, [body], [{ mode: 'cash', amountPaise: 20000 }], { approval: { username: 'asha', password: 'pass-1234' } }), 'FORBIDDEN', 'not allowed');
    const inv = await bill(app, [body], [{ mode: 'cash', amountPaise: 20000 }], { approval: { username: OWNER.username, password: OWNER.password } });
    expect(inv.discountPaise).toBe(0);
    const log = app.rt.db.prepare("SELECT username, approver_username FROM audit_logs WHERE action = 'billing.discount_override'").get();
    expect(log).toEqual({ username: 'asha', approver_username: 'owner' });
  });
});

describe('collecting pending payments', () => {
  it('supports credit sales only when enabled', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 5);
    await expectError(bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 5000 }]), 'VALIDATION', 'less than');
    await app.call('settings:update', { patch: { 'billing.allow_credit': true } });
    const inv = await bill(app, [{ productId: p.id, qty: 1 }], [{ mode: 'cash', amountPaise: 5000 }]);
    expect(inv.paymentStatus).toBe('partial');
    expect(inv.duePaise).toBe(13500 - 5000);
    const paid = await app.call('sales:collectDue', { invoiceId: inv.id, payments: [{ mode: 'upi', amountPaise: 8500 }] });
    expect(paid.paymentStatus).toBe('paid');
    expect(paid.duePaise).toBe(0);
  });
});
