/**
 * Raw command encoders for dedicated barcode-label printers (TVS LP 46, TSC, Zebra, Xprinter ...): the label row is drawn as an
 * image and sent as a bitmap inside TSPL (TSC language) or ZPL (Zebra language) commands, through a raw print queue. No printer
 * driver is needed. One image = one printed row of the roll (all labels that sit side by side).
 */
import { packBits, type GrayRaster } from './escpos';

export interface RowJob {
  /** Label row images, all the same size. */
  rows: GrayRaster[];
  /** Media (roll) size of one printed row, in mm. */
  widthMm: number;
  heightMm: number;
  /** Gap between rows on the roll, in mm. */
  gapMm: number;
  /** Swap black and white (some firmware reads bitmaps the other way round). */
  invert?: boolean;
  /** Pixels darker than this become black dots. */
  threshold?: number;
}

const num = (n: number): string => String(Math.round(n * 100) / 100);

/** Rotate a raster by 180 degrees (labels that come out upside down). */
export function rotate180(r: GrayRaster): GrayRaster {
  const gray = new Uint8Array(r.gray.length);
  for (let i = 0; i < r.gray.length; i++) gray[r.gray.length - 1 - i] = r.gray[i];
  return { width: r.width, height: r.height, gray };
}

/** TSPL: SIZE/GAP once, then CLS + BITMAP + PRINT for every row. In TSPL BITMAP data a 0 bit is a black dot. */
export function encodeTspl(job: RowJob): Buffer {
  if (job.rows.length === 0) throw new RangeError('No label rows');
  const parts: Buffer[] = [Buffer.from(`SIZE ${num(job.widthMm)} mm,${num(job.heightMm)} mm\r\nGAP ${num(job.gapMm)} mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\n`, 'ascii')];
  for (const r of job.rows) {
    const { bytesPerRow, data } = packBits(r, job.threshold);
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) out[i] = job.invert ? data[i] : ~data[i] & 0xff; // packBits: 1 = black; TSPL wants 0 = black
    parts.push(Buffer.from(`CLS\r\nBITMAP 0,0,${bytesPerRow},${r.height},0,`, 'ascii'), out, Buffer.from('\r\nPRINT 1,1\r\n', 'ascii'));
  }
  return Buffer.concat(parts);
}

/** ZPL II: one ^XA..^XZ format per row with the image as a ^GFA graphic field (1 = black). */
export function encodeZpl(job: RowJob, dpmm: number): Buffer {
  if (job.rows.length === 0) throw new RangeError('No label rows');
  const parts: string[] = [];
  for (const r of job.rows) {
    const { bytesPerRow, data } = packBits(r, job.threshold);
    let hex = '';
    for (let i = 0; i < data.length; i++) hex += (job.invert ? ~data[i] & 0xff : data[i]).toString(16).toUpperCase().padStart(2, '0');
    const total = data.length;
    const lengthDots = Math.round((job.heightMm + job.gapMm) * dpmm);
    parts.push(`^XA^MNY^PW${r.width}^LL${lengthDots}^LH0,0^FO0,0^GFA,${total},${total},${bytesPerRow},${hex}^FS^PQ1^XZ\r\n`);
  }
  return Buffer.from(parts.join(''), 'ascii');
}

/** Decode the bitmaps of a TSPL job back to one black/white image per row (tests and diagnostics). */
export function decodeTspl(buf: Buffer): { header: string; rows: { width: number; height: number; gray: Uint8Array }[]; prints: number } {
  const rows: { width: number; height: number; gray: Uint8Array }[] = [];
  let prints = 0;
  const text = buf.toString('latin1');
  const header = text.slice(0, text.indexOf('CLS'));
  let i = 0;
  for (;;) {
    const at = text.indexOf('BITMAP ', i);
    if (at < 0) break;
    const m = /^BITMAP (\d+),(\d+),(\d+),(\d+),(\d+),/.exec(text.slice(at, at + 64));
    if (!m) throw new Error('Bad BITMAP command');
    const bpr = Number(m[3]);
    const h = Number(m[4]);
    const start = at + m[0].length;
    const bytes = buf.subarray(start, start + bpr * h);
    const gray = new Uint8Array(bpr * 8 * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < bpr * 8; x++) gray[y * bpr * 8 + x] = bytes[y * bpr + (x >> 3)] & (0x80 >> (x & 7)) ? 255 : 0; // 1 = white
    rows.push({ width: bpr * 8, height: h, gray });
    i = start + bpr * h;
  }
  for (const _ of text.matchAll(/PRINT 1,1/g)) prints++;
  return { header, rows, prints };
}

/** Decode the graphic fields of a ZPL job back to images (1 = black). */
export function decodeZpl(buf: Buffer): { rows: { width: number; height: number; gray: Uint8Array }[]; formats: number } {
  const text = buf.toString('ascii');
  const rows: { width: number; height: number; gray: Uint8Array }[] = [];
  for (const m of text.matchAll(/\^GFA,(\d+),(\d+),(\d+),([0-9A-F]+)\^FS/g)) {
    const bpr = Number(m[3]);
    const total = Number(m[1]);
    const h = total / bpr;
    const gray = new Uint8Array(bpr * 8 * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < bpr * 8; x++) gray[y * bpr * 8 + x] = parseInt(m[4].slice((y * bpr + (x >> 3)) * 2, (y * bpr + (x >> 3)) * 2 + 2), 16) & (0x80 >> (x & 7)) ? 0 : 255;
    rows.push({ width: bpr * 8, height: h, gray });
  }
  return { rows, formats: (text.match(/\^XA/g) ?? []).length };
}
