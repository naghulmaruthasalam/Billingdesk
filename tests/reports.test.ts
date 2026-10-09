import { describe, expect, it } from 'vitest';
import { makeApp, setStock, rid } from './helpers';

async function sell(app: any, productId: number, qty: number, payments: any[]) {
  return app.call('billing:create', { clientRequestId: rid(), lines: [{ productId, qty }], payments });
}

describe('dashboard and reports', () => {
  it('reports sales, discounts, payment modes and returns without calling revenue profit', async () => {
    const app = await makeApp();
    const a = await setStock(app, 'SK-045', 20); // 150 -> 135
    const g = await setStock(app, 'SK-110', 5); // 450 no discount
    await sell(app, a.id, 2, [{ mode: 'cash', amountPaise: 30000 }]); // 270
    await sell(app, g.id, 1, [{ mode: 'upi', amountPaise: 45000 }]); // 450
    const inv3 = await sell(app, a.id, 1, [{ mode: 'card', amountPaise: 13500 }]); // 135
    await app.call('sales:cancel', { invoiceId: inv3.id, reason: 'test' });
    const dash = await app.call('dashboard:get', {});
    expect(dash).toMatchObject({ bills: 2, grossPaise: 30000 + 45000, discountPaise: 3000, netPaise: 72000, totalPaise: 72000, averagePaise: 36000, cancelledBills: 1 });
    const modes = Object.fromEntries(dash.paymentTotals.map((p: any) => [p.mode, p.netPaise]));
    expect(modes).toEqual({ card: 0, cash: 27000, upi: 45000 });

    const sum = await app.call('reports:run', { name: 'sales_summary', from: '2025-10-01', to: '2025-10-31' });
    expect(sum.rows).toHaveLength(1);
    expect(sum.totals).toMatchObject({ bills: 2, gross: 75000, discount: 3000, net: 72000, total: 72000 });
    expect(sum.notes.join(' ')).toMatch(/not profit/);
    expect(sum.columns.map((c: any) => c.label)).not.toContain('Profit');

    const byCat = await app.call('reports:run', { name: 'sales_by_category', from: '2025-10-01', to: '2025-10-31' });
    expect(byCat.rows.map((r: any) => r.category).sort()).toEqual(['Bomb', 'Gift Boxes']);
    const recon = await app.call('reports:run', { name: 'payment_reconciliation', from: '2025-10-20', to: '2025-10-20' });
    const cash = recon.rows.find((r: any) => r.mode === 'cash');
    expect(cash).toMatchObject({ sales: 27000, refunds: 0, net: 27000 });
    expect(recon.rows.find((r: any) => r.mode === 'card')).toMatchObject({ sales: 13500, refunds: 13500, net: 0 });
    const disc = await app.call('reports:run', { name: 'discounts', from: '2025-10-01', to: '2025-10-31' });
    expect(disc.totals.discount).toBe(3000);
    const rc = await app.call('reports:run', { name: 'returns_cancellations', from: '2025-10-01', to: '2025-10-31' });
    expect(rc.rows.map((r: any) => r.kind)).toEqual(['Cancellation']);
  });

  it('computes profit only from lines with a valid cost and reports coverage', async () => {
    const app = await makeApp();
    const a = await setStock(app, 'SK-045', 10);
    const b = await setStock(app, 'SK-046', 10);
    await app.call('purchases:create', { purchaseDate: '2025-10-20', lines: [{ productId: a.id, qty: 10, unitCostPaise: 10000 }] });
    await sell(app, a.id, 2, [{ mode: 'cash', amountPaise: 30000 }]); // net 270, cost 200
    await sell(app, b.id, 1, [{ mode: 'cash', amountPaise: 20000 }]); // no cost known
    const p = await app.call('reports:run', { name: 'profit', from: '2025-10-01', to: '2025-10-31' });
    const get = (label: string) => p.rows.find((r: any) => r.metric.startsWith(label)).value;
    expect(get('Gross profit')).toBe(27000 - 20000);
    expect(get('Net sales on all lines')).toBe(27000 + 15300);
    expect(p.notes[0]).toMatch(/1 of 2 bill lines \(50%\)/);
  });

  it('exports CSV and XLSX with plain numeric rupee values', async () => {
    const app = await makeApp();
    const a = await setStock(app, 'SK-045', 5);
    await sell(app, a.id, 1, [{ mode: 'cash', amountPaise: 20000 }]);
    const csv = await app.call('reports:export', { name: 'sales_by_product', from: '2025-10-01', to: '2025-10-31', format: 'csv' });
    expect(csv.filename).toBe('sales_by_product-2025-10-01-to-2025-10-31.csv');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('Classic Bomb');
    expect(csv.text).toContain('135.00');
    const x = await app.call('reports:export', { name: 'sales_by_product', from: '2025-10-01', to: '2025-10-31', format: 'xlsx' });
    const bytes = Buffer.from(x.base64, 'base64');
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    const { unzipSync, strFromU8 } = await import('fflate');
    const files = unzipSync(new Uint8Array(bytes));
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml');
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toContain('Classic Bomb');
  });

  it('rejects invalid ranges', async () => {
    const app = await makeApp();
    expect((await app.raw('reports:run', { name: 'sales_summary', from: '2025-10-31', to: '2025-10-01' })) as any).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('manages expenses with voids instead of deletion', async () => {
    const app = await makeApp();
    const e = await app.call('expenses:create', { expenseDate: '2025-10-20', category: 'Transport', amountPaise: 50000, paymentMode: 'cash' });
    await app.call('expenses:create', { expenseDate: '2025-10-20', category: 'Rent', amountPaise: 200000, paymentMode: 'upi' });
    await app.call('expenses:void', { id: e.id, reason: 'Entered twice' });
    const list = await app.call('expenses:list', { from: '2025-10-01', to: '2025-10-31' });
    expect(list.totalPaise).toBe(200000);
    expect((await app.call('expenses:list', { includeVoided: true })).rows).toHaveLength(2);
    const rep = await app.call('reports:run', { name: 'expenses', from: '2025-10-01', to: '2025-10-31' });
    expect(rep.totals.amount).toBe(200000);
  });
});
