/**
 * EAN-13 barcodes. Every product gets a shop-internal EAN-13 (restricted-circulation prefix "2"), which every
 * retail scanner reads without configuration, and which survives keyboard-layout differences because it is digits only.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
/** Parity pattern of the six left-hand digits, selected by the first digit. */
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** EAN check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new RangeError('EAN-13 needs exactly 12 digits to calculate the check digit');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export const isValidEan13 = (code: string): boolean => /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);

/** Shop-internal EAN-13 from a sequence number: "2" + 11-digit zero-padded sequence + check digit. */
export function internalEan13(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 99_999_999_999) throw new RangeError('Barcode sequence out of range');
  const body = `2${String(seq).padStart(11, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}

/** The 95 modules (1 = bar) of an EAN-13 symbol, without quiet zones. */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new RangeError(`Not a valid EAN-13: ${code}`);
  const d = [...code].map(Number);
  const parity = PARITY[d[0]];
  let m = '101';
  for (let i = 0; i < 6; i++) m += (parity[i] === 'L' ? L : G)[d[i + 1]];
  m += '01010';
  for (let i = 0; i < 6; i++) m += R[d[i + 7]];
  return `${m}101`;
}

export interface BarcodeSvgOptions {
  /** Height of the bars in modules-independent units (SVG user units are modules horizontally). */
  barHeight?: number;
  /** Print the human-readable digits under the bars. */
  text?: boolean;
  /** CSS width of the whole SVG (e.g. "38mm"); height follows from the aspect ratio. */
  width?: string;
  /** Digit font family. */
  fontFamily?: string;
}

const QUIET_LEFT = 11;
const QUIET_RIGHT = 7;

/**
 * EAN-13 as a self-contained SVG. 1 user unit = 1 module, so the printed X-dimension is width / (95 + quiet zones).
 * Rendering uses crisp edges so thin bars stay sharp at label-printer resolutions.
 */
export function ean13Svg(code: string, opts: BarcodeSvgOptions = {}): string {
  const modules = ean13Modules(code);
  const barH = opts.barHeight ?? 60;
  const guardExtra = opts.text === false ? 0 : 5;
  const textH = opts.text === false ? 0 : 12;
  const totalW = QUIET_LEFT + 95 + QUIET_RIGHT;
  const totalH = barH + guardExtra + textH;
  const guard = new Set<number>();
  for (const i of [0, 1, 2, 46, 47, 48, 49, 50, 92, 93, 94]) guard.add(i);
  let rects = '';
  for (let i = 0; i < 95; ) {
    if (modules[i] !== '1') {
      i++;
      continue;
    }
    let j = i;
    while (j < 95 && modules[j] === '1') j++;
    // Guard bars (start, centre, end) extend below the data bars, as in the EAN specification.
    const isGuard = guard.has(i);
    rects += `<rect x="${QUIET_LEFT + i}" y="0" width="${j - i}" height="${barH + (isGuard ? guardExtra : 0)}"/>`;
    i = j;
  }
  let text = '';
  if (opts.text !== false) {
    const y = barH + guardExtra + 9;
    const ff = opts.fontFamily ?? "Inter, 'Noto Sans Tamil', sans-serif";
    const style = `font-family:${ff};font-size:10px;font-variant-numeric:tabular-nums`;
    text += `<text x="${QUIET_LEFT - 3}" y="${y}" text-anchor="end" style="${style}">${code[0]}</text>`;
    text += `<text x="${QUIET_LEFT + 3 + 21}" y="${y}" text-anchor="middle" style="${style}" textLength="42" lengthAdjust="spacing">${code.slice(1, 7)}</text>`;
    text += `<text x="${QUIET_LEFT + 50 + 21}" y="${y}" text-anchor="middle" style="${style}" textLength="42" lengthAdjust="spacing">${code.slice(7)}</text>`;
  }
  const w = opts.width ? ` width="${opts.width}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}"${w} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Barcode ${code}" shape-rendering="crispEdges"><rect width="${totalW}" height="${totalH}" fill="#fff"/><g fill="#000">${rects}</g>${text}</svg>`;
}

/** Total module width including quiet zones (used to size the symbol to a label). */
export const EAN13_TOTAL_MODULES = QUIET_LEFT + 95 + QUIET_RIGHT;
