import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const TZ = 'Asia/Kolkata';
const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
const df = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const fmtDateTime = (iso: string): string => dtf.format(new Date(iso)).replace(',', '');
export const fmtDate = (iso: string): string => df.format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso));
/** Today's business date (Asia/Kolkata) as YYYY-MM-DD. */
export const todayIST = (): string => ymd.format(new Date());
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  return shiftDate(date, -dow);
}
export const startOfMonth = (date: string): string => `${date.slice(0, 7)}-01`;

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const newRequestId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export const MODE_LABELS: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', credit_note: 'Credit note' };
