import { computeTotals, type InvoiceTotals, type PaymentInput } from '@shared/pricing';
import type { AllSettings, ProductDTO } from '@/lib/types';
import type { PrintableInvoice } from '@shared/invoiceHtml';

export interface CartLine {
  key: string;
  product: ProductDTO;
  qty: number;
  /** Replaces (never stacks with) the policy discount. null = use policy. */
  overrideBp: number | null;
  overrideReason: string;
}

export interface CustomerInput {
  name: string;
  phone: string;
}

export const lineDiscountBp = (l: CartLine): number => (l.overrideBp !== null ? l.overrideBp : l.product.effectiveDiscountBp);

export function cartTotals(lines: CartLine[], s: AllSettings): InvoiceTotals {
  return computeTotals(
    lines.map((l) => ({ qty: l.qty, ratePaise: l.product.pricePaise ?? 0, discountBp: lineDiscountBp(l) })),
    { roundingScope: s['discount.rounding_scope'], roundingUnit: s['discount.rounding_unit'] },
    { enabled: s['tax.enabled'], rateBp: s['tax.rate_bp'], inclusive: s['tax.inclusive'] },
  );
}

/** Build a draft document for the pre-sale bill preview (clearly marked, no invoice number yet). */
export function draftInvoice(lines: CartLine[], totals: InvoiceTotals, s: AllSettings, payments: PaymentInput[], cashier: string, customer: CustomerInput): PrintableInvoice {
  const cashTendered = payments.filter((p) => p.mode === 'cash').reduce((a, p) => a + p.amountPaise, 0);
  const nonCash = payments.filter((p) => p.mode !== 'cash').reduce((a, p) => a + p.amountPaise, 0);
  const cashApplied = Math.max(Math.min(cashTendered, totals.totalPaise - nonCash), 0);
  return {
    invoiceNo: 'DRAFT - not yet billed',
    status: 'completed',
    createdAt: new Date().toISOString(),
    cashierName: cashier,
    customerName: customer.name || null,
    customerPhone: customer.phone || null,
    lines: lines.map((l, i) => ({
      nameEn: l.product.nameEn,
      nameTa: l.product.nameTa,
      unit: l.product.unit,
      qty: l.qty,
      ratePaise: l.product.pricePaise ?? 0,
      discountBp: lineDiscountBp(l),
      discountPaise: totals.lines[i].discountPaise,
      netPaise: totals.lines[i].netPaise,
    })),
    subtotalPaise: totals.subtotalPaise,
    discountPaise: totals.discountPaise,
    discountRoundingPaise: totals.discountRoundingPaise,
    taxPaise: totals.taxPaise,
    taxEnabled: s['tax.enabled'],
    taxRateBp: s['tax.rate_bp'],
    taxInclusive: s['tax.inclusive'],
    totalPaise: totals.totalPaise,
    payments: payments.map((p) => ({ kind: 'sale', mode: p.mode, amountPaise: p.mode === 'cash' ? cashApplied : p.amountPaise, tenderedPaise: p.amountPaise })),
    paidPaise: cashApplied + nonCash,
    duePaise: Math.max(totals.totalPaise - cashApplied - nonCash, 0),
    changePaise: Math.max(cashTendered - cashApplied, 0),
    cancelReason: null,
    sample: true,
  };
}
