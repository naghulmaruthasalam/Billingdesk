import { EAN13_TOTAL_MODULES, ean13Svg, isValidEan13 } from './barcode';
import { formatINR } from './money';
import { esc } from './invoiceHtml';

export interface LabelLayout {
  /** 'thermal': one label per page on a label roll. 'a4': a grid of labels on A4 sticker sheets. */
  kind: 'thermal' | 'a4';
  widthMm: number;
  heightMm: number;
  cols: number;
  rows: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapMm: number;
  showPrice: boolean;
  showTamil: boolean;
  showShop: boolean;
}

/** 50 x 30 mm roll label is the most common size for 203-dpi thermal label printers. */
export const DEFAULT_LABEL_LAYOUT: LabelLayout = { kind: 'thermal', widthMm: 50, heightMm: 30, cols: 3, rows: 8, marginTopMm: 10, marginLeftMm: 7, gapMm: 0, showPrice: true, showTamil: false, showShop: true };

export interface LabelItem {
  sku: string;
  nameEn: string;
  nameTa: string;
  unit: string;
  pricePaise: number | null;
  barcode: string | null;
}

export interface LabelGeometry {
  pageWidthMm: number;
  pageHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  perPage: number;
}

export const A4_MM = { w: 210, h: 297 };

/** Label cell size and page capacity for a layout. A4 sheets divide the printable area into cols x rows cells. */
export function labelGeometry(l: LabelLayout): LabelGeometry {
  if (l.kind === 'thermal') return { pageWidthMm: l.widthMm, pageHeightMm: l.heightMm, labelWidthMm: l.widthMm, labelHeightMm: l.heightMm, perPage: 1 };
  const w = (A4_MM.w - 2 * l.marginLeftMm - (l.cols - 1) * l.gapMm) / l.cols;
  const h = (A4_MM.h - 2 * l.marginTopMm - (l.rows - 1) * l.gapMm) / l.rows;
  return { pageWidthMm: A4_MM.w, pageHeightMm: A4_MM.h, labelWidthMm: w, labelHeightMm: h, perPage: l.cols * l.rows };
}

const mm = (n: number): string => `${Math.round(n * 100) / 100}mm`;

export interface LabelsResult {
  html: string;
  /** Labels actually drawn (excludes skipped products and blank start positions). */
  labels: number;
  pages: number;
  geometry: LabelGeometry;
  /** Printed width of one barcode module (X-dimension) in mm. Scanners need roughly 0.25 mm or more. */
  moduleMm: number;
  skipped: { sku: string; nameEn: string; reason: string }[];
}

/**
 * HTML for a run of barcode labels. `items` is already expanded by copy count. `startAt` leaves the first N cells of an
 * A4 sheet empty so a partly used sticker sheet can be reused.
 */
export function renderLabelsHtml(items: LabelItem[], shopName: string, layout: LabelLayout, opts: { fontBase: string; startAt?: number }): LabelsResult {
  const g = labelGeometry(layout);
  const W = g.labelWidthMm;
  const H = g.labelHeightMm;
  const u = Math.max(0.5, Math.min(W / 50, H / 30));
  const pad = Math.max(0.8, 1.4 * u);
  const skipped: LabelsResult['skipped'] = [];
  const cells: (string | null)[] = [];
  const barW = W - 2 * pad;
  // Bars must fit both the width and the height left under the text lines.
  const textLines = (layout.showShop ? 2.4 : 0) + 3.2 + (layout.showTamil ? 3.0 : 0) + (layout.showPrice ? 3.8 : 0);
  const barAreaH = Math.max(6, H - 2 * pad - textLines * u);
  const barSvgAspect = EAN13_TOTAL_MODULES / 47; // viewBox is 113 x 47 with barHeight 30 and text
  const drawnW = Math.min(barW, barAreaH * barSvgAspect);
  const moduleMm = drawnW / EAN13_TOTAL_MODULES;

  for (let i = 0; i < Math.max(0, opts.startAt ?? 0) && layout.kind === 'a4'; i++) cells.push(null);
  let labels = 0;
  for (const it of items) {
    if (!it.barcode || !isValidEan13(it.barcode)) {
      if (!skipped.some((s) => s.sku === it.sku)) skipped.push({ sku: it.sku, nameEn: it.nameEn, reason: it.barcode ? `"${it.barcode}" is not an EAN-13, so it cannot be drawn` : 'no barcode' });
      continue;
    }
    labels++;
    const price = layout.showPrice && it.pricePaise !== null ? `<div class="pr">${esc(formatINR(it.pricePaise))}<span class="un"> / ${esc(it.unit)}</span></div>` : '';
    cells.push(
      `<div class="lb">${layout.showShop ? `<div class="sh">${esc(shopName)}</div>` : ''}<div class="nm">${esc(it.nameEn)}</div>${layout.showTamil && it.nameTa ? `<div class="ta tm">${esc(it.nameTa)}</div>` : ''}${price}<div class="bc">${ean13Svg(it.barcode, { barHeight: 30, width: mm(drawnW) })}</div></div>`,
    );
  }

  const css = `
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:'Inter','Noto Sans Tamil',sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ta{font-family:'Noto Sans Tamil','Inter',sans-serif}
.lb{width:${mm(W)};height:${mm(H)};padding:${mm(pad)};overflow:hidden;display:flex;flex-direction:column;align-items:center;text-align:center;line-height:1.15;background:#fff;${layout.kind === 'a4' ? 'outline:0.1mm dotted #ddd;' : ''}}
.sh{font-size:${mm(2.0 * u)};letter-spacing:.02em;color:#000;white-space:nowrap;overflow:hidden;max-width:100%}
.nm{font-size:${mm(2.9 * u)};font-weight:700;max-width:100%;max-height:${mm(2.9 * u * 2.3)};overflow:hidden}
.tm{font-size:${mm(2.7 * u)};max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:clip}
.pr{font-size:${mm(3.5 * u)};font-weight:700;font-variant-numeric:tabular-nums}.un{font-size:${mm(2.4 * u)};font-weight:500}
.bc{flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center}
.bc svg{display:block;max-width:100%;max-height:100%}
${
  layout.kind === 'thermal'
    ? `@page{size:${mm(W)} ${mm(H)};margin:0}.lb{page-break-after:always;break-after:page}.lb:last-child{page-break-after:auto;break-after:auto}`
    : `@page{size:A4;margin:0}.sheet{width:210mm;height:297mm;padding:${mm(layout.marginTopMm)} ${mm(layout.marginLeftMm)};display:grid;grid-template-columns:repeat(${layout.cols},${mm(W)});grid-auto-rows:${mm(H)};gap:${mm(layout.gapMm)};align-content:start;justify-content:start;page-break-after:always;break-after:page;overflow:hidden}.sheet:last-child{page-break-after:auto;break-after:auto}.blank{width:${mm(W)};height:${mm(H)}}`
}
@media screen{body{background:#e9e6dc}${layout.kind === 'thermal' ? '.lb{margin:6px auto;box-shadow:0 0 0 1px #bbb}' : '.sheet{margin:8px auto;box-shadow:0 0 0 1px #bbb;background:#fff}'}}
`;

  let body = '';
  let pages = 0;
  if (layout.kind === 'thermal') {
    body = cells.filter((c): c is string => c !== null).join('');
    pages = labels;
  } else {
    const per = g.perPage;
    pages = Math.max(1, Math.ceil(cells.length / per));
    for (let p = 0; p < pages; p++) {
      const chunk = cells.slice(p * per, (p + 1) * per).map((c) => c ?? '<div class="blank"></div>');
      body += `<div class="sheet">${chunk.join('')}</div>`;
    }
    if (cells.length === 0) pages = 0;
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Barcode labels</title><link rel="stylesheet" href="${esc(opts.fontBase)}/fonts.css"><style>${css}</style></head><body>${body}</body></html>`;
  return { html, labels, pages, geometry: g, moduleMm, skipped };
}
