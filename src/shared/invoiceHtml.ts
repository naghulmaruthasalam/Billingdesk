import { formatAmount, formatINR, bpToPercent } from './money';

export type ReceiptSize = '58mm' | '80mm' | 'a4';

export interface PrintableShop {
  nameEn: string;
  nameTa: string;
  address: string;
  addressTa: string;
  phones: string[];
  taxId: string;
  logoDataUrl: string;
  footerEn: string;
  footerTa: string;
  taxLabel: string;
  showTamil: boolean;
}

export interface PrintableInvoice {
  invoiceNo: string;
  status: 'completed' | 'cancelled';
  createdAt: string;
  cashierName: string;
  customerName: string | null;
  customerPhone: string | null;
  lines: { nameEn: string; nameTa: string; unit: string; qty: number; ratePaise: number; discountBp: number; discountPaise: number; netPaise: number }[];
  subtotalPaise: number;
  discountPaise: number;
  discountRoundingPaise: number;
  taxPaise: number;
  taxEnabled: boolean;
  taxRateBp: number;
  taxInclusive: boolean;
  totalPaise: number;
  payments: { kind: string; mode: string; amountPaise: number; tenderedPaise: number | null }[];
  paidPaise: number;
  duePaise: number;
  changePaise: number;
  cancelReason: string | null;
  /** Marks the document as a reprint. */
  reprint?: boolean;
  /** Marks demonstration/test documents. */
  sample?: boolean;
  /** Marks an unsaved bill shown as a pre-sale preview. */
  draft?: boolean;
}

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  return f.format(d).replace(',', '');
};

const MODE_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', credit_note: 'Credit note' };

/** Page size in micrometres for Electron's print API (thermal rolls use a measured height). */
export const PAPER_WIDTH_MICRONS: Record<ReceiptSize, number> = { '58mm': 58000, '80mm': 80000, a4: 210000 };

const CSS = (size: ReceiptSize) => `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{font-family:'Inter','Noto Sans Tamil',sans-serif;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.ta{font-family:'Noto Sans Tamil','Inter',sans-serif}
.num{font-family:'Inter',sans-serif;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.sample,.cancelled{border:1.5px solid #000;text-align:center;font-weight:700;padding:2px;margin:4px 0;letter-spacing:.05em}
${
  size === 'a4'
    ? `@page{size:A4;margin:14mm}
body{font-size:12px;line-height:1.45;width:100%}
.doc{max-width:182mm;margin:0 auto}
header{display:flex;gap:16px;align-items:center;border-bottom:2px solid #155D43;padding-bottom:10px;margin-bottom:10px}
header img{height:64px;width:auto}
h1{font-size:20px;margin:0;color:#155D43}
h2{font-size:15px;margin:0;font-weight:600}
.meta{display:flex;justify-content:space-between;margin:8px 0 12px;gap:12px}
.meta div{flex:1}
table{width:100%;border-collapse:collapse}
th{background:#E4F3EA;color:#155D43;text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid #155D43}
th.r{text-align:right}
td{padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}
tr{break-inside:avoid}
.totals{margin-left:auto;margin-top:10px;width:260px}
.totals div{display:flex;justify-content:space-between;padding:2px 0}
.totals .grand{font-weight:700;font-size:15px;border-top:2px solid #155D43;margin-top:4px;padding-top:6px}
.foot{margin-top:18px;text-align:center;color:#444;font-size:11px;border-top:1px solid #ccc;padding-top:8px}`
    : `@page{size:${size} auto;margin:0}
body{width:${size === '58mm' ? '48mm' : '72mm'};margin:0 auto;padding:2mm 0;font-size:${size === '58mm' ? '10px' : '11.5px'};line-height:1.35}
.c{text-align:center}
h1{font-size:${size === '58mm' ? '12px' : '14px'};margin:2px 0;text-align:center}
h2{font-size:${size === '58mm' ? '11px' : '12px'};margin:0;text-align:center;font-weight:600}
.logo{display:block;margin:0 auto 3px;max-height:44px;max-width:60%}
hr{border:0;border-top:1px dashed #000;margin:4px 0}
.row{display:flex;justify-content:space-between;gap:6px}
.it{margin:3px 0;break-inside:avoid}
.it .n{font-weight:600}
.it .d{display:flex;justify-content:space-between;gap:6px}
.totals .row{padding:1px 0}
.totals .grand{font-weight:700;font-size:${size === '58mm' ? '12px' : '14px'};border-top:1px solid #000;border-bottom:1px solid #000;margin:3px 0;padding:2px 0}
.foot{margin-top:4px;text-align:center;font-size:${size === '58mm' ? '9px' : '10px'}}`
}
@media screen{body{background:#fff}}
`;

function totalsRows(inv: PrintableInvoice, shop: PrintableShop, cls: 'a4' | 'thermal'): string {
  const rows: [string, string, string?][] = [];
  rows.push(['Subtotal', formatINR(inv.subtotalPaise)]);
  if (inv.discountPaise > 0) rows.push(['Discount', `-${formatINR(inv.discountPaise)}`]);
  if (inv.taxEnabled && inv.taxRateBp > 0) {
    rows.push([`${shop.taxLabel} ${bpToPercent(inv.taxRateBp)}%${inv.taxInclusive ? ' (incl.)' : ''}`, formatINR(inv.taxPaise)]);
  }
  rows.push(['Net payable', formatINR(inv.totalPaise), 'grand']);
  const row = (l: string, v: string, c?: string) => (cls === 'a4' ? `<div class="${c ?? ''}"><span>${esc(l)}</span><span class="num">${esc(v)}</span></div>` : `<div class="row ${c ?? ''}"><span>${esc(l)}</span><span class="num">${esc(v)}</span></div>`);
  let out = rows.map(([l, v, c]) => row(l, v, c)).join('');
  for (const p of inv.payments.filter((x) => x.kind !== 'refund')) {
    out += row(`Paid - ${MODE_LABEL[p.mode] ?? p.mode}${p.mode === 'cash' && p.tenderedPaise && p.tenderedPaise > p.amountPaise ? ` (tendered ${formatAmount(p.tenderedPaise)})` : ''}`, formatINR(p.amountPaise));
  }
  if (inv.changePaise > 0) out += row('Change returned', formatINR(inv.changePaise));
  if (inv.duePaise > 0) out += row('Balance due', formatINR(inv.duePaise), 'grand');
  return out;
}

export interface InvoiceHtmlOptions {
  size: ReceiptSize;
  /** URL prefix of the bundled fonts folder, e.g. "./fonts" or "file:///.../fonts". */
  fontBase: string;
  autoPrint?: boolean;
}

/** Self-contained HTML for a bill. Used for the in-app preview, printing, and PDF export so all three match. */
export function renderInvoiceHtml(inv: PrintableInvoice, shop: PrintableShop, opts: InvoiceHtmlOptions): string {
  const { size } = opts;
  const ta = (s: string) => (shop.showTamil && s ? `<div class="ta">${esc(s)}</div>` : '');
  const banners =
    (inv.sample ? '<div class="sample">SAMPLE - TEST PRINT, NOT A BILL</div>' : '') +
    (inv.draft ? '<div class="sample">DRAFT PREVIEW - NOT YET BILLED</div>' : '') +
    (inv.status === 'cancelled' ? `<div class="cancelled">CANCELLED${inv.cancelReason ? ` - ${esc(inv.cancelReason)}` : ''}</div>` : '') +
    (inv.reprint && !inv.sample ? '<div class="c" style="font-size:.85em">DUPLICATE COPY</div>' : '');
  const phones = shop.phones.filter(Boolean).join(', ');
  const customer = inv.customerName || inv.customerPhone ? `${esc(inv.customerName ?? '')}${inv.customerPhone ? ` ${esc(inv.customerPhone)}` : ''}` : '';
  const head = `<link rel="stylesheet" href="${esc(opts.fontBase)}/fonts.css"><style>${CSS(size)}</style>`;
  const script = opts.autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),200))</script>' : '';

  if (size === 'a4') {
    const rows = inv.lines
      .map(
        (l, i) => `<tr><td>${i + 1}</td><td><div>${esc(l.nameEn)}</div>${ta(l.nameTa)}</td><td class="num">${l.qty} ${esc(l.unit)}</td><td class="num">${formatAmount(l.ratePaise)}</td><td class="num">${l.discountPaise ? `${formatAmount(l.discountPaise)} (${bpToPercent(l.discountBp)}%)` : '-'}</td><td class="num">${formatAmount(l.netPaise)}</td></tr>`,
      )
      .join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(inv.invoiceNo)}</title>${head}</head><body><div class="doc">
<header>${shop.logoDataUrl ? `<img src="${esc(shop.logoDataUrl)}" alt="">` : ''}<div><h1>${esc(shop.nameEn)}</h1>${shop.showTamil ? `<h2 class="ta">${esc(shop.nameTa)}</h2>` : ''}<div>${esc(shop.address)}</div>${shop.showTamil && shop.addressTa ? `<div class="ta">${esc(shop.addressTa)}</div>` : ''}<div>${phones ? `Phone: ${esc(phones)}` : ''}${shop.taxId ? ` &nbsp; ${esc(shop.taxLabel)} No: ${esc(shop.taxId)}` : ''}</div></div></header>
${banners}
<div class="meta"><div><strong>Invoice:</strong> ${esc(inv.invoiceNo)}<br><strong>Date:</strong> ${esc(fmtDateTime(inv.createdAt))}</div><div><strong>Cashier:</strong> ${esc(inv.cashierName)}${customer ? `<br><strong>Customer:</strong> ${customer}` : ''}</div></div>
<table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate (₹)</th><th class="r">Discount (₹)</th><th class="r">Amount (₹)</th></tr></thead><tbody>${rows}</tbody></table>
<div class="totals">${totalsRows(inv, shop, 'a4')}</div>
<div class="foot">${esc(shop.footerEn)}${shop.showTamil && shop.footerTa ? `<div class="ta">${esc(shop.footerTa)}</div>` : ''}</div>
</div>${script}</body></html>`;
  }

  const items = inv.lines
    .map(
      (l) => `<div class="it"><div class="n">${esc(l.nameEn)}</div>${ta(l.nameTa)}<div class="d"><span class="num" style="text-align:left">${l.qty} ${esc(l.unit)} x ${formatAmount(l.ratePaise)}${l.discountPaise ? ` &minus;${formatAmount(l.discountPaise)}` : ''}</span><span class="num">${formatAmount(l.netPaise)}</span></div></div>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(inv.invoiceNo)}</title>${head}</head><body>
${shop.logoDataUrl ? `<img class="logo" src="${esc(shop.logoDataUrl)}" alt="">` : ''}
<h1>${esc(shop.nameEn)}</h1>${shop.showTamil ? `<h2 class="ta">${esc(shop.nameTa)}</h2>` : ''}
<div class="c">${esc(shop.address)}</div>${shop.showTamil && shop.addressTa ? `<div class="c ta">${esc(shop.addressTa)}</div>` : ''}
<div class="c">${phones ? `Ph: ${esc(phones)}` : ''}</div>${shop.taxId ? `<div class="c">${esc(shop.taxLabel)} No: ${esc(shop.taxId)}</div>` : ''}
<hr>${banners}
<div class="row"><span>Bill: <b>${esc(inv.invoiceNo)}</b></span><span>${esc(fmtDateTime(inv.createdAt))}</span></div>
<div class="row"><span>Cashier: ${esc(inv.cashierName)}</span></div>${customer ? `<div>Customer: ${customer}</div>` : ''}
<hr>${items}<hr>
<div class="totals">${totalsRows(inv, shop, 'thermal')}</div>
<hr><div class="foot">${esc(shop.footerEn)}${shop.showTamil && shop.footerTa ? `<div class="ta">${esc(shop.footerTa)}</div>` : ''}</div>${script}</body></html>`;
}

/** Fabricated bill used only by "Print test page" in Settings. Clearly labelled as SAMPLE. */
export function sampleInvoice(): PrintableInvoice {
  return {
    invoiceNo: 'TEST-000000',
    status: 'completed',
    createdAt: new Date().toISOString(),
    cashierName: 'Test',
    customerName: null,
    customerPhone: null,
    lines: [
      { nameEn: 'Sample Item (test)', nameTa: 'மாதிரி பொருள்', unit: 'Box', qty: 2, ratePaise: 10000, discountBp: 1000, discountPaise: 2000, netPaise: 18000 },
      { nameEn: 'Gift Box 20 Items (test)', nameTa: '20 அயிட்டம்', unit: 'Box', qty: 1, ratePaise: 45000, discountBp: 0, discountPaise: 0, netPaise: 45000 },
    ],
    subtotalPaise: 65000,
    discountPaise: 2000,
    discountRoundingPaise: 0,
    taxPaise: 0,
    taxEnabled: false,
    taxRateBp: 0,
    taxInclusive: false,
    totalPaise: 63000,
    payments: [{ kind: 'sale', mode: 'cash', amountPaise: 63000, tenderedPaise: 70000 }],
    paidPaise: 63000,
    duePaise: 0,
    changePaise: 7000,
    cancelReason: null,
    sample: true,
  };
}
