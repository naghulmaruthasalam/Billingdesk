/**
 * ESC/POS raster encoding for thermal receipt printers (Epson TM, Rongta RP, Xprinter, ...).
 * The receipt is drawn as an image (so Tamil, bold text, logos and barcodes all work) and sent as a 1-bit raster with
 * GS v 0. This needs no printer driver: the bytes go to the printer through a raw print queue.
 */

export interface GrayRaster {
  width: number;
  height: number;
  /** One byte per pixel, 0 = black ... 255 = white, row-major. */
  gray: Uint8Array;
}

export interface EscPosOptions {
  /** Cut the paper after each receipt (ignored by printers without a cutter). */
  cut: boolean;
  copies: number;
  /** Pixels darker than this become black dots. */
  threshold?: number;
  /** Blank lines fed before the cut so the last line clears the cutter. */
  feedLines?: number;
}

/** Rows per GS v 0 command. Small bands keep printers with little receive buffer reliable. */
const BAND_ROWS = 128;

const INIT = [0x1b, 0x40]; // ESC @
const cutBytes = [0x1d, 0x56, 0x01]; // GS V 1: partial cut

/** Pack a grayscale raster into 1 bit per pixel, MSB first, black = 1, width padded with white to a multiple of 8. */
export function packBits(r: GrayRaster, threshold = 170): { bytesPerRow: number; data: Uint8Array } {
  const bytesPerRow = Math.ceil(r.width / 8);
  const data = new Uint8Array(bytesPerRow * r.height);
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      if (r.gray[y * r.width + x] < threshold) data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bytesPerRow, data };
}

export function encodeReceipt(r: GrayRaster, opts: EscPosOptions): Buffer {
  if (r.width <= 0 || r.height <= 0 || r.gray.length !== r.width * r.height) throw new RangeError('Invalid raster');
  const { bytesPerRow, data } = packBits(r, opts.threshold);
  if (bytesPerRow > 0xffff) throw new RangeError('Raster too wide');
  const parts: Buffer[] = [];
  const copies = Math.max(1, Math.min(opts.copies, 10));
  for (let c = 0; c < copies; c++) {
    parts.push(Buffer.from(INIT));
    for (let y = 0; y < r.height; y += BAND_ROWS) {
      const rows = Math.min(BAND_ROWS, r.height - y);
      parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, rows & 0xff, rows >> 8]));
      parts.push(Buffer.from(data.subarray(y * bytesPerRow, (y + rows) * bytesPerRow)));
    }
    parts.push(Buffer.from([0x1b, 0x64, Math.max(0, Math.min(opts.feedLines ?? 4, 255))])); // ESC d n: feed n lines
    if (opts.cut) parts.push(Buffer.from(cutBytes));
  }
  return Buffer.concat(parts);
}

/** Decode the raster blocks of an ESC/POS stream (used by tests and diagnostics). */
export function decodeEscPos(buf: Buffer): { width: number; height: number; bits: Uint8Array; receipts: number; cuts: number; startsWithInit: boolean } {
  let i = 0;
  let width = 0;
  let height = 0;
  const rows: Buffer[] = [];
  let receipts = 0;
  let cuts = 0;
  const startsWithInit = buf[0] === 0x1b && buf[1] === 0x40;
  while (i < buf.length) {
    if (buf[i] === 0x1b && buf[i + 1] === 0x40) {
      receipts++;
      i += 2;
    } else if (buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
      const bpr = buf[i + 4] | (buf[i + 5] << 8);
      const h = buf[i + 6] | (buf[i + 7] << 8);
      rows.push(buf.subarray(i + 8, i + 8 + bpr * h));
      width = bpr * 8;
      height += h;
      i += 8 + bpr * h;
    } else if (buf[i] === 0x1b && buf[i + 1] === 0x64) {
      i += 3;
    } else if (buf[i] === 0x1d && buf[i + 1] === 0x56) {
      cuts++;
      i += 3;
    } else throw new Error(`Unexpected byte 0x${buf[i].toString(16)} at ${i}`);
  }
  return { width, height, bits: new Uint8Array(Buffer.concat(rows)), receipts, cuts, startsWithInit };
}

/** BGRA (Electron NativeImage.toBitmap) to grayscale, compositing transparent pixels over white. */
export function bgraToGray(bgra: Uint8Array, width: number, height: number): GrayRaster {
  const gray = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    const b = bgra[p * 4];
    const g = bgra[p * 4 + 1];
    const r = bgra[p * 4 + 2];
    const a = bgra[p * 4 + 3] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = Math.round(lum * a + 255 * (1 - a));
  }
  return { width, height, gray };
}

/** Dots per line for common thermal paper widths (203 dpi = 8 dots/mm) and the printable width in mm. */
export const THERMAL_PAPER = { '80mm': { dots: 576, printableMm: 72 }, '58mm': { dots: 384, printableMm: 48 } } as const;
