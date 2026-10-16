/** Heuristics about installed printers, shared by the main process (to choose how to print) and the Settings screen. */

export interface PrinterIdentity {
  name: string;
  displayName?: string;
  /** Driver description reported by the print system, e.g. "Generic text-only printer". */
  model?: string;
}

/**
 * True for printers that cannot print a normal rendered page through their driver: queues with a text-only or raw driver,
 * or that look like thermal receipt printers (RP-3200, Epson TM-T20, Xprinter XP-58, ...). These need the ESC/POS method.
 */
export function looksThermal(p: PrinterIdentity | undefined): boolean {
  if (!p) return false;
  if (/text[- ]?only|\braw\b/i.test(p.model ?? '')) return true;
  // CUPS names often use underscores (EPSON_TM-T82), so a letter-boundary is used instead of \b.
  return /(?<![A-Za-z])(RP-?\d|TM-?[A-Z]?\d|XP-?\d|TSP|POS(?![A-Za-z])|thermal|receipt)/i.test(`${p.name} ${p.displayName ?? ''}`);
}

export type ReceiptMethod = 'auto' | 'driver' | 'escpos';

/** Which way a receipt goes to a printer. 'auto' picks ESC/POS for thermal-looking queues on Linux, the driver otherwise. */
export function resolveReceiptMethod(method: ReceiptMethod, printer: PrinterIdentity | undefined, platform: string): 'driver' | 'escpos' {
  if (method === 'driver') return 'driver';
  if (method === 'escpos') return 'escpos';
  return platform !== 'win32' && looksThermal(printer) ? 'escpos' : 'driver';
}
