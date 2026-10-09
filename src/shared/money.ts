/**
 * Money helpers. All monetary values are integer paise (1 INR = 100 paise).
 * No floating point arithmetic is used for amounts.
 */

/** Divide two non-negative-or-negative integers, rounding half away from zero. */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) {
    throw new RangeError('roundDiv requires integers and a non-zero denominator');
  }
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  return sign * (r * 2 >= d ? q + 1 : q);
}

/** Parse a user-typed rupee amount ("1,100", "45.5", "₹16.00") into paise. Returns null when invalid. */
export function parseRupees(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[₹,\s]|Rs\.?/gi, '');
  if (s === '') return null;
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? '').padEnd(2, '0') || '0');
  const paise = whole * 100 + frac;
  if (!Number.isSafeInteger(paise)) return null;
  return m[1] ? -paise : paise;
}

/** Group digits using the Indian numbering system (12,34,567). */
function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** Format paise as a plain amount with two decimals and Indian grouping: 110050 -> "1,100.50". */
export function formatAmount(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${groupIndian(String(whole))}.${frac}`;
}

/** Format paise as INR: 110050 -> "₹1,100.50". */
export function formatINR(paise: number): string {
  const s = formatAmount(paise);
  return s.startsWith('-') ? `-₹${s.slice(1)}` : `₹${s}`;
}

/** Paise to a plain decimal string for CSV/edit fields: 110050 -> "1100.50". */
export function paiseToDecimal(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Basis points (1% = 100 bp) to percentage text. 1000 -> "10", 250 -> "2.5". */
export function bpToPercent(bp: number): string {
  const p = bp / 100;
  return Number.isInteger(p) ? String(p) : p.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function percentToBp(input: string | number): number | null {
  const s = String(input).replace(/%/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const bp = Math.round(Number(s) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}
