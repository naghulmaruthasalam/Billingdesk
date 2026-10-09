/** Minimal RFC 4180 CSV parser/serializer (UTF-8, handles BOM, quoted fields, embedded newlines). */

export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** Guard against spreadsheet formula injection when files are opened in Excel. */
function safeCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^([=+@]|-(?![\d.]))/.test(s)) s = `'${s}`;
  return s;
}

export function toCsv(rows: unknown[][], opts: { bom?: boolean } = {}): string {
  const body = rows
    .map((r) =>
      r
        .map((v) => {
          const s = safeCell(v);
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
  return (opts.bom === false ? '' : '﻿') + body + '\r\n';
}

/** Convert parsed CSV into objects keyed by normalized (lower_snake) header names. */
export function csvToObjects(rows: string[][]): { headers: string[]; records: Record<string, string>[] } {
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const records = rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => {
      o[h] = (r[i] ?? '').trim();
    });
    return o;
  });
  return { headers, records };
}
