import type { Db } from './db/connection';
import { tx } from './db/connection';
import { nextCounter } from './counters';
import { auditSystem } from './audit';
import { internalEan13, isValidEan13 } from '../shared/barcode';
import { AppError } from './errors';

/**
 * Validate a barcode typed by a user (e.g. a manufacturer's code printed on a carton). 13-digit codes must carry a
 * correct EAN-13 check digit so a mistyped number is caught immediately; other lengths are accepted for lookup only.
 */
export function normalizeBarcodeInput(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(v)) throw new AppError('VALIDATION', 'Barcode may contain letters, digits, dot, dash and underscore (3-40 characters)');
  if (/^\d{13}$/.test(v) && !isValidEan13(v)) throw new AppError('VALIDATION', `${v} is not a valid EAN-13: the check digit is wrong. Re-scan or retype it.`);
  return v;
}

/** Next unused shop-internal EAN-13. Skips any code already taken (for instance typed in by hand). */
export function allocateBarcode(db: Db): string {
  const taken = db.prepare('SELECT 1 FROM products WHERE barcode = ?');
  for (let i = 0; i < 1000; i++) {
    const code = internalEan13(nextCounter(db, 'barcode'));
    if (!taken.get(code)) return code;
  }
  throw new AppError('INTERNAL', 'Could not allocate a free barcode');
}

/**
 * Guarantee that every product has a barcode. Runs at start-up, so databases created before barcodes existed are
 * upgraded in place. Existing barcodes are never changed - a printed label stays valid forever.
 */
export function ensureBarcodes(db: Db, now: Date): number {
  const missing = db.prepare('SELECT id FROM products WHERE barcode IS NULL OR barcode = \'\' ORDER BY sort_order, id').all() as { id: number }[];
  if (missing.length === 0) return 0;
  tx(db, () => {
    const set = db.prepare('UPDATE products SET barcode = ? WHERE id = ?');
    for (const { id } of missing) set.run(allocateBarcode(db), id);
    auditSystem(db, now, 'barcode.assign', null, { count: missing.length }, 'products');
  });
  return missing.length;
}

export interface BarcodeLookup {
  productId: number;
}
