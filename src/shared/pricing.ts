import { roundDiv } from './money';

export type RoundingScope = 'line' | 'invoice';
export type RoundingUnit = 'paisa' | 'rupee';
export type DiscountRule = 'inherit' | 'eligible' | 'never';

export interface DiscountPolicy {
  /** Default shop discount in basis points (1000 = 10%). */
  defaultBp: number;
  /** Where rounding of discount happens. */
  roundingScope: RoundingScope;
  /** Rounding granularity for the discount amount. */
  roundingUnit: RoundingUnit;
}

export interface TaxConfig {
  enabled: boolean;
  rateBp: number;
  inclusive: boolean;
}

export interface PricingLineInput {
  qty: number;
  ratePaise: number;
  /** The single effective discount for the line (policy or override). Discounts never stack. */
  discountBp: number;
}

export interface PricedLine {
  grossPaise: number;
  discountPaise: number;
  netPaise: number;
}

export interface InvoiceTotals {
  lines: PricedLine[];
  /** Sum of list amounts (qty x rate). */
  subtotalPaise: number;
  /** Invoice-level discount (authoritative). */
  discountPaise: number;
  /** discountPaise minus the sum of displayed line discounts (non-zero only for invoice-scope rounding). */
  discountRoundingPaise: number;
  /** subtotal - discount. */
  netPaise: number;
  taxPaise: number;
  /** Amount payable. */
  totalPaise: number;
}

const unitPaise = (u: RoundingUnit) => (u === 'rupee' ? 100 : 1);

/** Resolve the discount percentage (bp) that applies to a product under the configured rules. */
export function resolveDiscountBp(args: {
  productRule: DiscountRule;
  categoryRule: DiscountRule;
  categoryBp: number | null;
  defaultBp: number;
}): number {
  const { productRule, categoryRule, categoryBp, defaultBp } = args;
  if (productRule === 'never') return 0;
  if (productRule === 'inherit' && categoryRule === 'never') return 0;
  return categoryBp ?? defaultBp;
}

/** Pure, integer-only invoice calculation shared by the main process (authoritative) and the UI (preview). */
export function computeTotals(lines: PricingLineInput[], policy: Pick<DiscountPolicy, 'roundingScope' | 'roundingUnit'>, tax: TaxConfig): InvoiceTotals {
  const unit = unitPaise(policy.roundingUnit);
  let subtotal = 0;
  let rawSum = 0; // sum of gross*bp, in paise*bp
  const priced: PricedLine[] = lines.map((l) => {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new RangeError('Quantity must be a positive whole number');
    if (!Number.isInteger(l.ratePaise) || l.ratePaise < 0) throw new RangeError('Rate must be a non-negative integer in paise');
    if (!Number.isInteger(l.discountBp) || l.discountBp < 0 || l.discountBp > 10000) throw new RangeError('Discount must be between 0 and 100%');
    const gross = l.qty * l.ratePaise;
    const raw = gross * l.discountBp;
    subtotal += gross;
    rawSum += raw;
    const disc = policy.roundingScope === 'line' ? roundDiv(raw, 10000 * unit) * unit : roundDiv(raw, 10000);
    const d = Math.min(disc, gross);
    return { grossPaise: gross, discountPaise: d, netPaise: gross - d };
  });
  const lineDiscountSum = priced.reduce((s, l) => s + l.discountPaise, 0);
  let discount = lineDiscountSum;
  if (policy.roundingScope === 'invoice') {
    discount = Math.min(roundDiv(rawSum, 10000 * unit) * unit, subtotal);
  }
  const net = subtotal - discount;
  let taxPaise = 0;
  let total = net;
  if (tax.enabled && tax.rateBp > 0) {
    if (tax.inclusive) {
      taxPaise = roundDiv(net * tax.rateBp, 10000 + tax.rateBp);
    } else {
      taxPaise = roundDiv(net * tax.rateBp, 10000);
      total = net + taxPaise;
    }
  }
  return {
    lines: priced,
    subtotalPaise: subtotal,
    discountPaise: discount,
    discountRoundingPaise: discount - lineDiscountSum,
    netPaise: net,
    taxPaise,
    totalPaise: total,
  };
}

export type PaymentMode = 'cash' | 'upi' | 'card';
export const PAYMENT_MODES: PaymentMode[] = ['cash', 'upi', 'card'];

export interface PaymentInput {
  mode: PaymentMode;
  /** For cash: the amount tendered. For UPI/card: the amount charged. */
  amountPaise: number;
  reference?: string | null;
}

export interface Settlement {
  payments: { mode: PaymentMode; amountPaise: number; tenderedPaise: number; reference: string | null }[];
  paidPaise: number;
  changePaise: number;
  duePaise: number;
  status: 'paid' | 'partial' | 'unpaid';
}

/**
 * Split-payment settlement. Non-cash payments must not exceed what is due; cash may be over-tendered and
 * the overage is returned as change. Under-payment is only allowed when `allowDue` is true.
 */
export function settlePayments(totalPaise: number, inputs: PaymentInput[], allowDue = false): Settlement {
  for (const p of inputs) {
    if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) throw new RangeError('Payment amounts must be positive');
  }
  const nonCash = inputs.filter((p) => p.mode !== 'cash');
  const cash = inputs.filter((p) => p.mode === 'cash');
  const nonCashSum = nonCash.reduce((s, p) => s + p.amountPaise, 0);
  if (nonCashSum > totalPaise) throw new RangeError('UPI/card amounts exceed the amount payable');
  const cashTendered = cash.reduce((s, p) => s + p.amountPaise, 0);
  const remaining = totalPaise - nonCashSum;
  const cashApplied = Math.min(cashTendered, remaining);
  const change = cashTendered - cashApplied;
  const paid = nonCashSum + cashApplied;
  const due = totalPaise - paid;
  if (due > 0 && !allowDue) throw new RangeError('Payment is less than the amount payable');
  const out: Settlement['payments'] = nonCash.map((p) => ({ mode: p.mode, amountPaise: p.amountPaise, tenderedPaise: p.amountPaise, reference: p.reference ?? null }));
  if (cashApplied > 0) {
    // Multiple cash rows are merged into a single ledger row.
    out.unshift({ mode: 'cash', amountPaise: cashApplied, tenderedPaise: cashTendered, reference: cash.find((c) => c.reference)?.reference ?? null });
  }
  return {
    payments: out,
    paidPaise: paid,
    changePaise: change,
    duePaise: due,
    status: due === 0 ? 'paid' : paid === 0 ? 'unpaid' : 'partial',
  };
}
