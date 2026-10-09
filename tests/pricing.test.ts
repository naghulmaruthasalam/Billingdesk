import { describe, expect, it } from 'vitest';
import { bpToPercent, formatAmount, formatINR, parseRupees, percentToBp, roundDiv } from '../src/shared/money';
import { computeTotals, resolveDiscountBp, settlePayments } from '../src/shared/pricing';

const noTax = { enabled: false, rateBp: 0, inclusive: false };
const line = { roundingScope: 'line' as const, roundingUnit: 'paisa' as const };

describe('money helpers', () => {
  it('parses rupee input without floating point', () => {
    expect(parseRupees('16')).toBe(1600);
    expect(parseRupees('1,100.50')).toBe(110050);
    expect(parseRupees('₹45.5')).toBe(4550);
    expect(parseRupees('0.07')).toBe(7);
    expect(parseRupees('abc')).toBeNull();
    expect(parseRupees('1.234')).toBeNull();
    expect(parseRupees('')).toBeNull();
  });
  it('formats INR with Indian digit grouping', () => {
    expect(formatINR(1600)).toBe('₹16.00');
    expect(formatINR(110050)).toBe('₹1,100.50');
    expect(formatINR(123456789)).toBe('₹12,34,567.89');
    expect(formatINR(-250)).toBe('-₹2.50');
    expect(formatAmount(440000)).toBe('4,400.00');
  });
  it('rounds half away from zero on integers', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(1, 3)).toBe(0);
  });
  it('converts percentages and basis points', () => {
    expect(percentToBp('10')).toBe(1000);
    expect(percentToBp('2.5%')).toBe(250);
    expect(percentToBp('101')).toBeNull();
    expect(bpToPercent(1000)).toBe('10');
    expect(bpToPercent(250)).toBe('2.5');
  });
});

describe('discount resolution', () => {
  const base = { productRule: 'inherit' as const, categoryRule: 'inherit' as const, categoryBp: null, defaultBp: 1000 };
  it('applies the shop default to inheriting products', () => expect(resolveDiscountBp(base)).toBe(1000));
  it('never discounts a product flagged non-discountable', () => expect(resolveDiscountBp({ ...base, productRule: 'never' })).toBe(0));
  it('never discounts products in a non-discountable category', () => expect(resolveDiscountBp({ ...base, categoryRule: 'never' })).toBe(0));
  it('lets an eligible product override a non-discountable category', () => expect(resolveDiscountBp({ ...base, productRule: 'eligible', categoryRule: 'never' })).toBe(1000));
  it('uses the category percentage when set', () => expect(resolveDiscountBp({ ...base, categoryBp: 500 })).toBe(500));
});

describe('invoice totals', () => {
  it('calculates 10% line discounts on whole-rupee prices', () => {
    const t = computeTotals([{ qty: 2, ratePaise: 10000, discountBp: 1000 }], line, noTax);
    expect(t.subtotalPaise).toBe(20000);
    expect(t.discountPaise).toBe(2000);
    expect(t.totalPaise).toBe(18000);
    expect(t.lines[0]).toEqual({ grossPaise: 20000, discountPaise: 2000, netPaise: 18000 });
  });
  it('applies discount only to eligible lines', () => {
    const t = computeTotals(
      [
        { qty: 1, ratePaise: 5500, discountBp: 1000 },
        { qty: 1, ratePaise: 45000, discountBp: 0 }, // gift box
      ],
      line,
      noTax,
    );
    expect(t.discountPaise).toBe(550);
    expect(t.totalPaise).toBe(5500 - 550 + 45000);
  });
  it('rounds per line to the nearest paisa (half up)', () => {
    // 10% of Rs 16.00 x 1 = 1.60, ok. 10% of 11.05 = 1.105 -> 1.11 (half up)
    const t = computeTotals([{ qty: 1, ratePaise: 1105, discountBp: 1000 }], line, noTax);
    expect(t.discountPaise).toBe(111); // 110.5 paise rounds up
  });
  it('differs between per-line and per-invoice rounding in a controlled case', () => {
    // three lines of 0.05 rupees (5 paise) with 10% => raw 0.5 paise each.
    const lines = [1, 2, 3].map(() => ({ qty: 1, ratePaise: 5, discountBp: 1000 }));
    const perLine = computeTotals(lines, line, noTax);
    const perInvoice = computeTotals(lines, { roundingScope: 'invoice', roundingUnit: 'paisa' }, noTax);
    expect(perLine.discountPaise).toBe(3); // each rounds 0.5 -> 1
    expect(perInvoice.discountPaise).toBe(2); // 1.5 total rounds to 2
    expect(perInvoice.discountRoundingPaise).toBe(perInvoice.discountPaise - perInvoice.lines.reduce((s, l) => s + l.discountPaise, 0));
    expect(perInvoice.totalPaise).toBe(15 - 2);
  });
  it('supports whole-rupee discount rounding', () => {
    const t = computeTotals([{ qty: 1, ratePaise: 5500, discountBp: 1000 }], { roundingScope: 'line', roundingUnit: 'rupee' }, noTax);
    expect(t.discountPaise).toBe(600); // 5.50 -> 6.00
    const inv = computeTotals([{ qty: 1, ratePaise: 5500, discountBp: 1000 }, { qty: 1, ratePaise: 5500, discountBp: 1000 }], { roundingScope: 'invoice', roundingUnit: 'rupee' }, noTax);
    expect(inv.discountPaise).toBe(1100); // 11.00 exactly
  });
  it('never lets the discount exceed the line amount', () => {
    const t = computeTotals([{ qty: 1, ratePaise: 1000, discountBp: 10000 }], line, noTax);
    expect(t.totalPaise).toBe(0);
  });
  it('handles exclusive and inclusive tax', () => {
    const ex = computeTotals([{ qty: 1, ratePaise: 10000, discountBp: 0 }], line, { enabled: true, rateBp: 1800, inclusive: false });
    expect(ex.taxPaise).toBe(1800);
    expect(ex.totalPaise).toBe(11800);
    const inc = computeTotals([{ qty: 1, ratePaise: 11800, discountBp: 0 }], line, { enabled: true, rateBp: 1800, inclusive: true });
    expect(inc.taxPaise).toBe(1800);
    expect(inc.totalPaise).toBe(11800);
    const off = computeTotals([{ qty: 1, ratePaise: 10000, discountBp: 0 }], line, { enabled: false, rateBp: 1800, inclusive: false });
    expect(off.taxPaise).toBe(0);
  });
  it('rejects invalid quantities, rates and discounts', () => {
    expect(() => computeTotals([{ qty: 0, ratePaise: 100, discountBp: 0 }], line, noTax)).toThrow();
    expect(() => computeTotals([{ qty: 1.5, ratePaise: 100, discountBp: 0 }], line, noTax)).toThrow();
    expect(() => computeTotals([{ qty: 1, ratePaise: -1, discountBp: 0 }], line, noTax)).toThrow();
    expect(() => computeTotals([{ qty: 1, ratePaise: 100, discountBp: 10001 }], line, noTax)).toThrow();
  });
  it('is exact for large bills (no floating point drift)', () => {
    const lines = Array.from({ length: 50 }, () => ({ qty: 3, ratePaise: 6600, discountBp: 1000 }));
    const t = computeTotals(lines, line, noTax);
    expect(t.subtotalPaise).toBe(50 * 3 * 6600);
    expect(t.discountPaise).toBe(50 * 1980);
  });
});

describe('payments and change', () => {
  it('computes change for an over-tendered cash payment', () => {
    const s = settlePayments(18000, [{ mode: 'cash', amountPaise: 20000 }]);
    expect(s.changePaise).toBe(2000);
    expect(s.paidPaise).toBe(18000);
    expect(s.payments).toEqual([{ mode: 'cash', amountPaise: 18000, tenderedPaise: 20000, reference: null }]);
    expect(s.status).toBe('paid');
  });
  it('splits between UPI and cash, giving change only on the cash part', () => {
    const s = settlePayments(10000, [
      { mode: 'upi', amountPaise: 6000, reference: 'UTR123' },
      { mode: 'cash', amountPaise: 5000 },
    ]);
    expect(s.paidPaise).toBe(10000);
    expect(s.changePaise).toBe(1000);
    expect(s.payments.find((p) => p.mode === 'cash')!.amountPaise).toBe(4000);
  });
  it('rejects non-cash overpayment and shortfalls', () => {
    expect(() => settlePayments(10000, [{ mode: 'upi', amountPaise: 12000 }])).toThrow(/exceed/);
    expect(() => settlePayments(10000, [{ mode: 'card', amountPaise: 5000 }])).toThrow(/less than/);
  });
  it('allows partial payment only when credit is enabled', () => {
    const s = settlePayments(10000, [{ mode: 'cash', amountPaise: 4000 }], true);
    expect(s.status).toBe('partial');
    expect(s.duePaise).toBe(6000);
    expect(settlePayments(10000, [], true).status).toBe('unpaid');
  });
  it('merges multiple cash entries into one ledger row', () => {
    const s = settlePayments(10000, [{ mode: 'cash', amountPaise: 5000 }, { mode: 'cash', amountPaise: 6000 }]);
    expect(s.payments).toHaveLength(1);
    expect(s.changePaise).toBe(1000);
  });
});
