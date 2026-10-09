import { describe, expect, it } from 'vitest';
import { makeApp, product, setStock, rid, expectError } from './helpers';

describe('inventory', () => {
  it('records every stock change with reason, user and timestamp', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 10);
    await expectError(app.call('inventory:adjust', { productId: p.id, mode: 'delta', qty: -1, reason: '' }), 'VALIDATION');
    await app.call('inventory:adjust', { productId: p.id, mode: 'delta', qty: -2, type: 'damage', reason: 'Rain damage' });
    await app.call('inventory:adjust', { productId: p.id, mode: 'set', qty: 6, reason: 'Recount' });
    expect((await product(app, 'SK-002')).stockQty).toBe(6);
    const rows = (await app.call('inventory:movements', { productId: p.id })).rows;
    expect(rows.map((r: any) => [r.type, r.qtyDelta, r.qtyAfter])).toEqual([['adjustment', -2, 6], ['damage', -2, 8], ['opening', 10, 10]]);
    expect(rows[0]).toMatchObject({ user: 'owner', reason: 'Recount' });
    expect(rows[0].createdAt).toMatch(/^2025-10-20T06:30:00/);
    // damage must reduce, negative stock is blocked
    await expectError(app.call('inventory:adjust', { productId: p.id, mode: 'delta', qty: 3, type: 'damage', reason: 'bad' }), 'VALIDATION', 'reduce');
    await expectError(app.call('inventory:adjust', { productId: p.id, mode: 'delta', qty: -50, reason: 'too many' }), 'INSUFFICIENT_STOCK');
  });

  it('the movement ledger always sums to the cached stock level', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 20);
    const inv = await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 5 }], payments: [{ mode: 'cash', amountPaise: 100000 }] });
    await app.call('returns:create', { clientRequestId: rid(), invoiceId: inv.id, refundMode: 'cash', reason: 'Changed mind', lines: [{ invoiceLineId: inv.lines[0].id, qty: 2, restock: true }] });
    await app.call('purchases:create', { purchaseDate: '2025-10-20', lines: [{ productId: p.id, qty: 7, unitCostPaise: 9000 }] });
    const sum = app.rt.db.prepare('SELECT SUM(qty_delta) s FROM inventory_movements WHERE product_id = ?').get(p.id) as { s: number };
    expect(sum.s).toBe((await product(app, 'SK-045')).stockQty);
    expect(sum.s).toBe(20 - 5 + 2 + 7);
  });

  it('imports opening balances from CSV preview rows and rejects bad lines', async () => {
    const app = await makeApp();
    const prev = await app.call('inventory:previewStockCsv', { text: 'sku,qty\nSK-001,12\nSK-999,3\nSK-002,-4\nSK-001,5' });
    expect(prev.map((r: any) => r.status)).toEqual(['ok', 'error', 'error', 'error']);
    expect(prev[1].issues).toContain('Unknown SKU');
    expect(prev[3].issues).toContain('Duplicate SKU in file');
    const ok = prev.filter((r: any) => r.status === 'ok');
    await app.call('inventory:setOpening', { rows: ok.map((r: any) => ({ productId: r.productId, qty: r.newQty })) });
    expect((await product(app, 'SK-001')).stockQty).toBe(12);
  });

  it('reconciles a day from the ledger and records physical-count corrections', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-045', 10);
    app.setClock(new Date('2025-10-21T06:30:00Z'));
    await app.call('billing:create', { clientRequestId: rid(), lines: [{ productId: p.id, qty: 4 }], payments: [{ mode: 'cash', amountPaise: 100000 }] });
    await app.call('purchases:create', { purchaseDate: '2025-10-21', lines: [{ productId: p.id, qty: 6, unitCostPaise: 10000 }] });
    const rec = (await app.call('inventory:reconcile', { date: '2025-10-21' })).find((r: any) => r.productId === p.id);
    expect(rec).toMatchObject({ openingQty: 10, purchased: 6, sold: -4, expectedClosing: 12, systemClosing: 12, variance: 0 });
    await app.call('inventory:count', { date: '2025-10-21', counts: [{ productId: p.id, countedQty: 11 }] });
    expect((await product(app, 'SK-045')).stockQty).toBe(11);
    const rec2 = (await app.call('inventory:reconcile', { date: '2025-10-21' })).find((r: any) => r.productId === p.id);
    expect(rec2).toMatchObject({ adjusted: -1, expectedClosing: 11, variance: 0 });
  });

  it('values stock only where purchase cost exists', async () => {
    const app = await makeApp();
    const a = await setStock(app, 'SK-045', 10);
    await setStock(app, 'SK-046', 5);
    await app.call('purchases:create', { purchaseDate: '2025-10-20', lines: [{ productId: a.id, qty: 10, unitCostPaise: 9000 }] });
    const v = await app.call('inventory:valuation');
    expect(v.totalPaise).toBe(20 * 9000);
    expect(v.productsWithoutCost).toBe(1);
    const low = await app.call('inventory:lowStock');
    expect(low.length).toBeGreaterThan(100); // every product with 0 stock and 0 minimum counts as low until entered
  });
});

describe('purchasing', () => {
  it('records a purchase from a supplier, updates stock and cost, and lists it', async () => {
    const app = await makeApp();
    const p = await setStock(app, 'SK-002', 0);
    const sup = await app.call('suppliers:save', { id: null, data: { name: 'Sivakasi Traders', phone: '9000000000', active: true } });
    const pur = await app.call('purchases:create', { supplierId: sup[0].id, supplierInvoiceNo: 'INV-77', purchaseDate: '2025-10-18', lines: [{ productId: p.id, qty: 40, unitCostPaise: 1500 }, { productId: (await product(app, 'SK-003')).id, qty: 10, unitCostPaise: null }] });
    expect(pur.totalPaise).toBe(60000);
    expect(pur.purchaseNo).toBe('PUR-00001');
    expect((await product(app, 'SK-002')).stockQty).toBe(40);
    expect((await product(app, 'SK-002')).costPaise).toBe(1500);
    expect((await product(app, 'SK-003')).costPaise).toBeNull();
    const detail = await app.call('purchases:get', { id: pur.id });
    expect(detail.lines).toHaveLength(2);
    expect(detail.supplierName).toBe('Sivakasi Traders');
    await expectError(app.call('suppliers:save', { id: null, data: { name: 'sivakasi traders', active: true } }), 'CONFLICT');
    await expectError(app.call('purchases:create', { purchaseDate: '2025-10-18', lines: [] }), 'VALIDATION');
  });
});
