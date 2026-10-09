import type { Db } from './db/connection';

/** Atomically increment and return a named counter. Call inside the transaction that consumes the number. */
export function nextCounter(db: Db, name: string): number {
  db.prepare('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1').run(name);
  return (db.prepare('SELECT value FROM counters WHERE name = ?').get(name) as { value: number }).value;
}

export const formatNumber = (prefix: string, seq: number, pad: number): string => `${prefix}${prefix ? '-' : ''}${String(seq).padStart(pad, '0')}`;
