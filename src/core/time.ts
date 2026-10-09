export const TIMEZONE = 'Asia/Kolkata';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Business date (YYYY-MM-DD) in Asia/Kolkata for a given instant. */
export function businessDate(d: Date): string {
  return dateFmt.format(d);
}

export const isoNow = (d: Date): string => d.toISOString();

/** Add days to a YYYY-MM-DD business date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export const isDateString = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** UTC ISO bounds for a business-date range [from, to] inclusive, interpreted in Asia/Kolkata (UTC+05:30, no DST). */
export function istRangeToUtc(from: string, to: string): { startIso: string; endIso: string } {
  return {
    startIso: new Date(`${from}T00:00:00+05:30`).toISOString(),
    endIso: new Date(`${addDays(to, 1)}T00:00:00+05:30`).toISOString(),
  };
}
