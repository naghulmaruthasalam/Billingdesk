import { describe, expect, it } from 'vitest';
import { makeApp, product, setStock, rid, expectError, addUser, loginAs, OWNER } from './helpers';

async function sale(app: any, lines: any[], mode = 'cash', amount = 1000000) {
  return app.call('billing:create', { clientRequestId: rid(), lines, payments: [{ mode, amountPaise: amount }] });
}
const ret = (app: any, body: any) => app.call('returns:create', { clientRequestId: rid(), refundMode: 'cash', reason: 'Customer returned', ...body });

describe('returns and refunds', () => {
  it('refunds the discounted price of partially returned items and restocks them', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 10); // Rs 150, 10% -> 135 each
    const inv = await sale(app, [{ productId: p.id, qty: 4 }]);
    expect(inv.totalPaise).toBe(54000);
    expect((await product(app, 'SK-045')).stockQty).toBe(6);
    const r = await ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: 1, restock: true }] });
    expect(r.refundPaise).toBe(13500);
    expect(r.returnNo).toBe('RET-00001');
    expect((await product(app, 'SK-045')).stockQty).toBe(7);
    const after = await app.call('sales:get', { id: inv.id });
    expect(after.refundedPaise).toBe(13500);
    expect(after.lines[0].returnedQty).toBe(1);
    expect(after.status).toBe('completed'); // the original bill is never rewritten
    expect(after.totalPaise).toBe(54000);
  });

  it('refunds exactly what was paid on a full return, absorbing rounding', async () => {
    const app = await makeApp();
    const a = await setStock(app, 'SK-012', 10); // 66.00 -> 10% = 6.60
    const b = await setStock(app, 'SK-105', 10); // 66.00
    await app.call('settings:update', { patch: { 'discount.rounding_scope': 'invoice', 'discount.rounding_unit': 'rupee' } });
    const inv = await sale(app, [{ productId: a.id, qty: 1 }, { productId: b.id, qty: 1 }]);
    expect(inv.totalPaise).toBe(13200 - 1300); // 13.20 -> rounds to 13.00
    const r = await ret(app, { invoiceId: inv.id, lines: inv.lines.map((l: any) => ({ invoiceLineId: l.id, qty: l.qty, restock: true })) });
    expect(r.refundPaise).toBe(inv.totalPaise);
  });

  it('supports several partial returns and never over-refunds', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-009', 10); // 65 -> 58.50
    const inv = await sale(app, [{ productId: p.id, qty: 3 }]);
    const line = inv.lines[0].id;
    const r1 = await ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: line, qty: 1, restock: true }] });
    const r2 = await ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: line, qty: 2, restock: true }] });
    expect(r1.refundPaise + r2.refundPaise).toBe(inv.totalPaise);
    await expectError(ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: line, qty: 1, restock: true }] }), 'VALIDATION', 'Only 0');
  });

  it('does not restock damaged returns but keeps a record', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 5);
    const inv = await sale(app, [{ productId: p.id, qty: 2 }]);
    await ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: 1, restock: false }], reason: 'Damaged in transit' });
    expect((await product(app, 'SK-045')).stockQty).toBe(3);
    const mv = (await app.call('inventory:movements', { productId: p.id })).rows;
    expect(mv[0]).toMatchObject({ type: 'return_damaged', qtyDelta: 0 });
    expect(mv[0].reason).toMatch(/damaged/);
  });

  it('requires a reason, valid quantities and is idempotent', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 5);
    const inv = await sale(app, [{ productId: p.id, qty: 2 }]);
    const line = inv.lines[0].id;
    await expectError(app.call('returns:create', { clientRequestId: rid(), invoiceId: inv.id, refundMode: 'cash', reason: '', lines: [{ invoiceLineId: line, qty: 1, restock: true }] }), 'VALIDATION');
    await expectError(ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: line, qty: 3, restock: true }] }), 'VALIDATION', 'Only 2');
    const key = rid();
    const body = { clientRequestId: key, invoiceId: inv.id, refundMode: 'upi', reason: 'Wrong item', lines: [{ invoiceLineId: line, qty: 1, restock: true }] };
    const a = await app.call('returns:create', body);
    const b = await app.call('returns:create', body);
    expect(b.id).toBe(a.id);
    expect((await product(app, 'SK-045')).stockQty).toBe(4);
  });

  it('refunds tax proportionally when tax is exclusive', async () => {
    const app = await makeApp();
    await app.call('settings:update', { patch: { 'tax.enabled': true, 'tax.rate_bp': 1800 } });
    const p = await setStock(app, 'SK-045', 5);
    const inv = await sale(app, [{ productId: p.id, qty: 2 }]); // net 270 + 48.60 = 318.60
    expect(inv.totalPaise).toBe(31860);
    const r = await ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: 2, restock: true }] });
    expect(r.refundPaise).toBe(31860);
  });
});

describe('cancellations', () => {
  it('voids a bill, restores stock, reverses payments and writes an audit trail', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-043', 10);
    const inv = await sale(app, [{ productId: p.id, qty: 3 }], 'upi', 24300);
    expect((await product(app, 'SK-043')).stockQty).toBe(7);
    await expectError(app.call('sales:cancel', { invoiceId: inv.id, reason: '' }), 'VALIDATION');
    const c = await app.call('sales:cancel', { invoiceId: inv.id, reason: 'Entered twice' });
    expect(c.status).toBe('cancelled');
    expect(c.cancelReason).toBe('Entered twice');
    expect(c.totalPaise).toBe(inv.totalPaise); // unchanged financial record
    expect(c.refundedPaise).toBe(24300);
    expect((await product(app, 'SK-043')).stockQty).toBe(10);
    const audit = (await app.call('audit:list', { action: 'invoice.cancel' })).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].details)).toMatchObject({ invoiceNo: inv.invoiceNo, reason: 'Entered twice' });
    await expectError(app.call('sales:cancel', { invoiceId: inv.id, reason: 'again' }), 'CONFLICT', 'already');
    await expectError(ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: 1, restock: true }] }), 'CONFLICT');
    expect((await app.call('dashboard:get', {})).bills).toBe(0);
  });

  it('cannot cancel a bill that already has returns', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-043', 10);
    const inv = await sale(app, [{ productId: p.id, qty: 3 }]);
    await ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: 1, restock: true }] });
    await expectError(app.call('sales:cancel', { invoiceId: inv.id, reason: 'oops' }), 'CONFLICT', 'returns');
  });

  it('needs supervisor approval for cashiers to cancel or refund', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-043', 10);
    const inv = await sale(app, [{ productId: p.id, qty: 2 }]);
    await addUser(app, 'asha', 'cashier');
    await loginAs(app, 'asha', 'pass-1234');
    await expectError(app.call('sales:cancel', { invoiceId: inv.id, reason: 'mistake' }), 'FORBIDDEN', 'approval');
    await expectError(ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: 1, restock: true }] }), 'FORBIDDEN', 'approval');
    const r = await ret(app, { invoiceId: inv.id, lines: [{ invoiceLineId: inv.lines[0].id, qty: 1, restock: true }], approval: { username: OWNER.username, password: OWNER.password } });
    expect(r.refundPaise).toBeGreaterThan(0);
    const row = app.rt.db.prepare("SELECT username, approver_username FROM audit_logs WHERE action='return.create'").get();
    expect(row).toEqual({ username: 'asha', approver_username: 'owner' });
  });
});
