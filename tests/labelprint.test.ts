import { describe, it, expect } from 'vitest';
import { encodeTspl, encodeZpl, decodeTspl, decodeZpl, rotate180 } from '../src/core/labelprint';
import { looksLabelPrinter, resolveLabelMethod } from '../src/shared/printers';
import { renderLabelsHtml, labelGeometry, DEFAULT_LABEL_LAYOUT } from '../src/shared/labelHtml';

const raster = (w: number, h: number, black: (x: number, y: number) => boolean) => {
  const gray = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (black(x, y)) gray[y * w + x] = 0;
  return { width: w, height: h, gray };
};

describe('TSPL / ZPL encoders', () => {
  const img = raster(24, 4, (x, y) => (x + y) % 5 === 0);

  it('TSPL: SIZE/GAP header, one CLS+BITMAP+PRINT per row, and the bitmap decodes back (0 bit = black)', () => {
    const buf = encodeTspl({ rows: [img, img], widthMm: 105, heightMm: 20, gapMm: 2 });
    const text = buf.toString('latin1');
    expect(text.startsWith('SIZE 105 mm,20 mm\r\nGAP 2 mm,0 mm\r\n')).toBe(true);
    expect(text.match(/CLS/g)).toHaveLength(2);
    expect(text.match(/BITMAP 0,0,3,4,0,/g)).toHaveLength(2);
    const d = decodeTspl(buf);
    expect(d.prints).toBe(2);
    expect(d.rows).toHaveLength(2);
    expect(d.rows[0].width).toBe(24);
    expect([...d.rows[0].gray]).toEqual([...img.gray]);
  });

  it('TSPL invert swaps the polarity for printers that read bitmaps the other way round', () => {
    const normal = decodeTspl(encodeTspl({ rows: [img], widthMm: 30, heightMm: 20, gapMm: 2 })).rows[0].gray;
    const inverted = decodeTspl(encodeTspl({ rows: [img], widthMm: 30, heightMm: 20, gapMm: 2, invert: true })).rows[0].gray;
    expect([...inverted]).toEqual([...normal].map((v) => 255 - v));
  });

  it('ZPL: one ^XA..^XZ per row with a ^GFA graphic field (1 = black) that decodes back', () => {
    const buf = encodeZpl({ rows: [img], widthMm: 30, heightMm: 20, gapMm: 2 }, 8);
    const text = buf.toString('ascii');
    expect(text).toContain('^XA');
    expect(text).toContain('^PW24');
    expect(text).toContain('^LL176'); // (20 + 2) mm at 8 dots/mm
    expect(text).toContain('^GFA,12,12,3,');
    expect([...decodeZpl(buf).rows[0].gray]).toEqual([...img.gray]);
  });

  it('rotate180 reverses the picture', () => {
    const r = rotate180(raster(8, 2, (x, y) => x === 0 && y === 0));
    expect(r.gray[8 * 2 - 1]).toBe(0); // the single black pixel moved from top-left to bottom-right
    expect(r.gray[0]).toBe(255);
  });
});

describe('label printer detection', () => {
  it('recognises the TVS LP 46 Lite and other label printers, but not receipt or office printers', () => {
    for (const name of ['LP-46-Lite', 'TVS_LP46_LITE', 'LP 46 LITE', 'TSC_TE244', 'Zebra_ZD220', 'XP-365B', 'Label_Printer']) expect(looksLabelPrinter({ name }), name).toBe(true);
    for (const name of ['RP-3200-LITE', 'EPSON_TM-T82', 'HP_LaserJet_1020', 'CUPS-PDF']) expect(looksLabelPrinter({ name }), name).toBe(false);
  });

  it('automatic label method: label printer -> TSPL, receipt printer -> ESC/POS, others -> driver; Windows always the driver', () => {
    expect(resolveLabelMethod('auto', { name: 'LP-46-Lite' }, 'linux')).toBe('tspl');
    expect(resolveLabelMethod('auto', { name: 'RP-3200-LITE' }, 'linux')).toBe('escpos');
    expect(resolveLabelMethod('auto', { name: 'HP_LaserJet' }, 'linux')).toBe('driver');
    expect(resolveLabelMethod('auto', { name: 'LP-46-Lite' }, 'win32')).toBe('driver');
    expect(resolveLabelMethod('zpl', { name: 'anything' }, 'linux')).toBe('zpl');
    expect(resolveLabelMethod('driver', { name: 'LP-46-Lite' }, 'linux')).toBe('driver');
  });
});

describe('roll labels several across (34 x 20 mm, 3 across)', () => {
  const layout = { ...DEFAULT_LABEL_LAYOUT, kind: 'thermal' as const, widthMm: 34, heightMm: 20, rollCols: 3, colGapMm: 2.5, rowGapMm: 2, rollLeftMm: 0, showShop: false };
  const item = (n: number) => ({ sku: `SK-${n}`, nameEn: `Item ${n}`, nameTa: '', unit: 'Box', pricePaise: 4500, barcode: n % 2 ? '2000000000015' : '2000000000022' });

  it('one page is one row of the roll: 3 x 34 mm + 2 gaps', () => {
    const g = labelGeometry(layout);
    expect(g).toMatchObject({ pageWidthMm: 3 * 34 + 2 * 2.5, pageHeightMm: 20, labelWidthMm: 34, labelHeightMm: 20, perPage: 3 });
  });

  it('puts 3 labels in each row and rounds the bars to whole printer dots', () => {
    const r = renderLabelsHtml([1, 2, 3, 4, 5].map(item), 'Shop', layout, { fontBase: '.', dotsPerMm: 203 / 25.4 });
    expect(r.labels).toBe(5);
    expect(r.pages).toBe(2); // 3 + 2
    expect(r.html.match(/class="rw"/g)).toHaveLength(2);
    expect(r.html).toContain('@page{size:107mm 20mm;margin:0}');
    const dots = (r.moduleMm * 203) / 25.4;
    expect(Math.abs(dots - Math.round(dots))).toBeLessThan(0.01); // a whole number of dots per bar module
    expect(r.moduleMm).toBeGreaterThanOrEqual(0.24);
  });

  it('a single-label roll is unchanged: no row wrapper', () => {
    const r = renderLabelsHtml([item(1), item(2)], 'Shop', { ...layout, rollCols: 1 }, { fontBase: '.' });
    expect(r.html).not.toContain('class="rw"');
    expect(r.pages).toBe(2);
  });

});
