import { z } from 'zod';
import type { Db } from './db/connection';
import { AppError } from './errors';
import { isDateString } from './time';
import { paiseToDecimal, formatAmount } from '../shared/money';
import { listMovements, lowStock, stockValuation } from './inventory';

export type ColType = 'text' | 'money' | 'int' | 'percent';
export interface ReportColumn {
  key: string;
  label: string;
  type: ColType;
}
export interface ReportTable {
  title: string;
  description?: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  notes?: string[];
}

export const reportParamsSchema = z.object({
  name: z.enum(['sales_summary', 'sales_by_product', 'sales_by_category', 'sales_by_cashier', 'payment_reconciliation', 'discounts', 'returns_cancellations', 'stock_movements', 'stock_valuation', 'low_stock', 'expenses', 'profit']),
  from: z.string().refine(isDateString, 'Invalid start date'),
  to: z.string().refine(isDateString, 'Invalid end date'),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});
export type ReportParams = z.input<typeof reportParamsSchema>;

const sum = (rows: Record<string, string | number | null>[], key: string) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);

export function runReport(db: Db, input: ReportParams): ReportTable {
  const p = reportParamsSchema.parse(input);
  if (p.from > p.to) throw new AppError('VALIDATION', 'The start date is after the end date');
  const { from, to } = p;
  const range = `${from} to ${to}`;
  const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as Record<string, string | number | null>[];

  switch (p.name) {
    case 'sales_summary': {
      const bucket = p.groupBy === 'month' ? "substr(i.business_date,1,7)" : p.groupBy === 'week' ? "date(i.business_date,'-6 days','weekday 1')" : 'i.business_date';
      const rows = all(
        `SELECT ${bucket} AS period, COUNT(*) AS bills, SUM(i.subtotal_paise) AS gross, SUM(i.discount_paise) AS discount,
           SUM(i.subtotal_paise - i.discount_paise) AS net, SUM(i.tax_paise) AS tax, SUM(i.total_paise) AS total
         FROM invoices i WHERE i.status='completed' AND i.business_date BETWEEN ? AND ? GROUP BY period ORDER BY period`,
        from,
        to,
      );
      const rets = all(`SELECT ${bucket.replace(/i\.business_date/g, 'r.business_date')} AS period, SUM(r.refund_paise) AS refunds FROM returns r WHERE r.business_date BETWEEN ? AND ? GROUP BY period`, from, to);
      const rmap = new Map<string, number>(rets.map((r) => [String(r.period), Number(r.refunds)]));
      const merged: Record<string, string | number | null>[] = rows.map((r) => ({ ...r, refunds: rmap.get(r.period as string) ?? 0 }));
      for (const r of rets) if (!merged.some((m) => m.period === r.period)) merged.push({ period: r.period, bills: 0, gross: 0, discount: 0, net: 0, tax: 0, total: 0, refunds: Number(r.refunds) });
      merged.sort((a, b) => String(a.period).localeCompare(String(b.period)));
      return {
        title: 'Sales summary',
        description: `Completed bills, ${range}, grouped by ${p.groupBy}. Weeks start on Monday.`,
        columns: [
          { key: 'period', label: p.groupBy === 'week' ? 'Week starting' : p.groupBy === 'month' ? 'Month' : 'Date', type: 'text' },
          { key: 'bills', label: 'Bills', type: 'int' },
          { key: 'gross', label: 'Gross sales', type: 'money' },
          { key: 'discount', label: 'Discounts', type: 'money' },
          { key: 'net', label: 'Net sales (before tax)', type: 'money' },
          { key: 'tax', label: 'Tax', type: 'money' },
          { key: 'total', label: 'Billed total', type: 'money' },
          { key: 'refunds', label: 'Returns refunded', type: 'money' },
        ],
        rows: merged,
        totals: { period: 'Total', bills: sum(merged, 'bills'), gross: sum(merged, 'gross'), discount: sum(merged, 'discount'), net: sum(merged, 'net'), tax: sum(merged, 'tax'), total: sum(merged, 'total'), refunds: sum(merged, 'refunds') },
        notes: ['Net sales is revenue after discount and before tax. It is not profit.', 'Cancelled bills are excluded. Returns are shown separately.'],
      };
    }
    case 'sales_by_product': {
      const rows = all(
        `SELECT l.sku, l.name_en AS name, l.name_ta AS name_ta, SUM(l.qty) AS qty, SUM(l.gross_paise) AS gross, SUM(l.discount_paise) AS discount, SUM(l.net_paise) AS net,
           COALESCE((SELECT SUM(rl.qty) FROM return_lines rl JOIN returns r ON r.id = rl.return_id WHERE rl.product_id = l.product_id AND r.business_date BETWEEN ? AND ?),0) AS returned_qty
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.status='completed' AND i.business_date BETWEEN ? AND ? GROUP BY l.product_id ORDER BY net DESC`,
        from,
        to,
        from,
        to,
      );
      return {
        title: 'Sales by product',
        description: range,
        columns: [
          { key: 'sku', label: 'SKU', type: 'text' },
          { key: 'name', label: 'Product', type: 'text' },
          { key: 'name_ta', label: 'தமிழ்', type: 'text' },
          { key: 'qty', label: 'Qty sold', type: 'int' },
          { key: 'gross', label: 'Gross', type: 'money' },
          { key: 'discount', label: 'Discount', type: 'money' },
          { key: 'net', label: 'Net', type: 'money' },
          { key: 'returned_qty', label: 'Qty returned', type: 'int' },
        ],
        rows,
        totals: { sku: 'Total', qty: sum(rows, 'qty'), gross: sum(rows, 'gross'), discount: sum(rows, 'discount'), net: sum(rows, 'net'), returned_qty: sum(rows, 'returned_qty') },
      };
    }
    case 'sales_by_category': {
      const rows = all(
        `SELECT c.name_en AS category, SUM(l.qty) AS qty, SUM(l.gross_paise) AS gross, SUM(l.discount_paise) AS discount, SUM(l.net_paise) AS net
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN products p ON p.id = l.product_id JOIN categories c ON c.id = p.category_id
         WHERE i.status='completed' AND i.business_date BETWEEN ? AND ? GROUP BY c.id ORDER BY net DESC`,
        from,
        to,
      );
      return {
        title: 'Sales by category',
        description: range,
        columns: [
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'qty', label: 'Qty sold', type: 'int' },
          { key: 'gross', label: 'Gross', type: 'money' },
          { key: 'discount', label: 'Discount', type: 'money' },
          { key: 'net', label: 'Net', type: 'money' },
        ],
        rows,
        totals: { category: 'Total', qty: sum(rows, 'qty'), gross: sum(rows, 'gross'), discount: sum(rows, 'discount'), net: sum(rows, 'net') },
      };
    }
    case 'sales_by_cashier': {
      const rows = all(
        `SELECT u.username AS cashier, u.display_name AS name, COUNT(*) AS bills, SUM(i.subtotal_paise) AS gross, SUM(i.discount_paise) AS discount, SUM(i.total_paise) AS total
         FROM invoices i JOIN users u ON u.id = i.cashier_id WHERE i.status='completed' AND i.business_date BETWEEN ? AND ? GROUP BY u.id ORDER BY total DESC`,
        from,
        to,
      );
      return {
        title: 'Sales by cashier',
        description: range,
        columns: [
          { key: 'cashier', label: 'User', type: 'text' },
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'bills', label: 'Bills', type: 'int' },
          { key: 'gross', label: 'Gross', type: 'money' },
          { key: 'discount', label: 'Discounts', type: 'money' },
          { key: 'total', label: 'Billed total', type: 'money' },
        ],
        rows,
        totals: { cashier: 'Total', bills: sum(rows, 'bills'), gross: sum(rows, 'gross'), discount: sum(rows, 'discount'), total: sum(rows, 'total') },
      };
    }
    case 'payment_reconciliation': {
      const rows: Record<string, string | number | null>[] = all(
        `SELECT mode,
           SUM(CASE WHEN kind='sale' THEN amount_paise ELSE 0 END) AS sales,
           SUM(CASE WHEN kind='due' THEN amount_paise ELSE 0 END) AS due_collected,
           SUM(CASE WHEN kind='refund' THEN amount_paise ELSE 0 END) AS refunds
         FROM payments WHERE business_date BETWEEN ? AND ? GROUP BY mode ORDER BY mode`,
        from,
        to,
      ).map((r) => ({ ...r, net: Number(r.sales) + Number(r.due_collected) - Number(r.refunds) }));
      const exp = all("SELECT payment_mode AS mode, SUM(amount_paise) AS s FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN ? AND ? GROUP BY payment_mode", from, to);
      const withExp = rows.map((r) => {
        const e = Number(exp.find((x) => x.mode === r.mode)?.s ?? 0);
        return { ...r, expenses: e, closing: Number(r.net) - e };
      });
      return {
        title: 'Cash / UPI / card reconciliation',
        description: `${range}. Collections by payment mode as received, less refunds paid out and expenses paid by the same mode.`,
        columns: [
          { key: 'mode', label: 'Mode', type: 'text' },
          { key: 'sales', label: 'Bill payments', type: 'money' },
          { key: 'due_collected', label: 'Pending collected', type: 'money' },
          { key: 'refunds', label: 'Refunds paid', type: 'money' },
          { key: 'net', label: 'Net collected', type: 'money' },
          { key: 'expenses', label: 'Expenses paid', type: 'money' },
          { key: 'closing', label: 'Net after expenses', type: 'money' },
        ],
        rows: withExp,
        totals: { mode: 'Total', sales: sum(withExp, 'sales'), due_collected: sum(withExp, 'due_collected'), refunds: sum(withExp, 'refunds'), net: sum(withExp, 'net'), expenses: sum(withExp, 'expenses'), closing: sum(withExp, 'closing') },
        notes: ['Cash amounts exclude change handed back to customers. Cancelled bills appear as refunds.'],
      };
    }
    case 'discounts': {
      const rows = all(
        `SELECT i.invoice_no AS invoice, i.business_date AS date, l.name_en AS product, l.discount_bp AS bp, l.discount_paise AS discount, l.discount_source AS source, COALESCE(l.override_reason,'') AS reason, u.username AS cashier
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN users u ON u.id = i.cashier_id
         WHERE i.status='completed' AND i.business_date BETWEEN ? AND ? AND (l.discount_paise > 0 OR l.discount_source='override') ORDER BY l.discount_source DESC, i.id DESC LIMIT 2000`,
        from,
        to,
      ).map((r) => ({ ...r, bp: Number(r.bp) / 100 }));
      const policy = all("SELECT COALESCE(SUM(l.discount_paise),0) s FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.status='completed' AND l.discount_source='policy' AND i.business_date BETWEEN ? AND ?", from, to)[0].s;
      const ovr = all("SELECT COALESCE(SUM(l.discount_paise),0) s FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.status='completed' AND l.discount_source='override' AND i.business_date BETWEEN ? AND ?", from, to)[0].s;
      return {
        title: 'Discounts granted',
        description: range,
        columns: [
          { key: 'invoice', label: 'Invoice', type: 'text' },
          { key: 'date', label: 'Date', type: 'text' },
          { key: 'product', label: 'Product', type: 'text' },
          { key: 'bp', label: 'Discount %', type: 'percent' },
          { key: 'discount', label: 'Discount', type: 'money' },
          { key: 'source', label: 'Source', type: 'text' },
          { key: 'reason', label: 'Override reason', type: 'text' },
          { key: 'cashier', label: 'Cashier', type: 'text' },
        ],
        rows,
        totals: { invoice: 'Total', discount: sum(rows, 'discount') },
        notes: [`Policy discounts: ₹${formatAmount(Number(policy))}. Manual overrides: ₹${formatAmount(Number(ovr))}.`],
      };
    }
    case 'returns_cancellations': {
      const rets = all(`SELECT r.return_no AS ref, 'Return' AS kind, r.business_date AS date, i.invoice_no AS invoice, r.refund_mode AS mode, r.refund_paise AS amount, r.reason AS reason, u.username AS user FROM returns r JOIN invoices i ON i.id=r.invoice_id JOIN users u ON u.id=r.created_by WHERE r.business_date BETWEEN ? AND ?`, from, to);
      const canc = all(`SELECT i.invoice_no AS ref, 'Cancellation' AS kind, substr(i.cancelled_at,1,10) AS date, i.invoice_no AS invoice, '' AS mode, i.total_paise AS amount, COALESCE(i.cancel_reason,'') AS reason, u.username AS user FROM invoices i JOIN users u ON u.id=i.cancelled_by WHERE i.status='cancelled' AND date(i.cancelled_at,'+5 hours','+30 minutes') BETWEEN ? AND ?`, from, to);
      const rows = [...rets, ...canc].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return {
        title: 'Returns and cancellations',
        description: range,
        columns: [
          { key: 'ref', label: 'Reference', type: 'text' },
          { key: 'kind', label: 'Type', type: 'text' },
          { key: 'date', label: 'Date', type: 'text' },
          { key: 'invoice', label: 'Invoice', type: 'text' },
          { key: 'mode', label: 'Refund mode', type: 'text' },
          { key: 'amount', label: 'Amount', type: 'money' },
          { key: 'reason', label: 'Reason', type: 'text' },
          { key: 'user', label: 'By', type: 'text' },
        ],
        rows,
        totals: { ref: 'Total', amount: sum(rows, 'amount') },
      };
    }
    case 'stock_movements': {
      const { rows } = listMovements(db, { from, to, limit: 5000 });
      return {
        title: 'Stock movements',
        description: range,
        columns: [
          { key: 'date', label: 'Date', type: 'text' },
          { key: 'sku', label: 'SKU', type: 'text' },
          { key: 'name', label: 'Product', type: 'text' },
          { key: 'type', label: 'Type', type: 'text' },
          { key: 'delta', label: 'Change', type: 'int' },
          { key: 'after', label: 'Balance', type: 'int' },
          { key: 'reason', label: 'Reason', type: 'text' },
          { key: 'user', label: 'By', type: 'text' },
        ],
        rows: rows.map((r) => ({ date: r.businessDate, sku: r.sku, name: r.nameEn, type: r.type, delta: r.qtyDelta, after: r.qtyAfter, reason: r.reason, user: r.user })),
      };
    }
    case 'stock_valuation': {
      const v = stockValuation(db);
      return {
        title: 'Stock valuation',
        description: 'Current stock at purchase cost. Products with no recorded cost are shown but not valued.',
        columns: [
          { key: 'sku', label: 'SKU', type: 'text' },
          { key: 'name', label: 'Product', type: 'text' },
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'qty', label: 'In stock', type: 'int' },
          { key: 'cost', label: 'Unit cost', type: 'money' },
          { key: 'value', label: 'Value', type: 'money' },
        ],
        rows: v.rows.map((r) => ({ sku: r.sku, name: r.nameEn, category: r.categoryName, qty: r.stockQty, cost: r.costPaise, value: r.valuePaise })),
        totals: { sku: 'Total (products with a cost)', value: v.totalPaise },
        notes: v.productsWithoutCost ? [`${v.productsWithoutCost} products in stock have no purchase cost and are not included in the total.`] : [],
      };
    }
    case 'low_stock': {
      const rows = lowStock(db, 1000).map((r) => ({ sku: r.sku, name: r.nameEn, name_ta: r.nameTa, unit: r.unit, stock: r.stockQty, min: r.minStock }));
      return {
        title: 'Low stock',
        description: 'Active products at or below their minimum stock threshold.',
        columns: [
          { key: 'sku', label: 'SKU', type: 'text' },
          { key: 'name', label: 'Product', type: 'text' },
          { key: 'name_ta', label: 'தமிழ்', type: 'text' },
          { key: 'unit', label: 'Unit', type: 'text' },
          { key: 'stock', label: 'In stock', type: 'int' },
          { key: 'min', label: 'Minimum', type: 'int' },
        ],
        rows,
      };
    }
    case 'expenses': {
      const rows = all('SELECT category, COUNT(*) AS entries, SUM(amount_paise) AS amount FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN ? AND ? GROUP BY category ORDER BY amount DESC', from, to);
      return {
        title: 'Expenses',
        description: range,
        columns: [
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'entries', label: 'Entries', type: 'int' },
          { key: 'amount', label: 'Amount', type: 'money' },
        ],
        rows,
        totals: { category: 'Total', entries: sum(rows, 'entries'), amount: sum(rows, 'amount') },
      };
    }
    case 'profit': {
      const row = all(
        `SELECT COALESCE(SUM(l.net_paise),0) AS revenue_all,
           COALESCE(SUM(CASE WHEN l.cost_paise IS NOT NULL THEN l.net_paise END),0) AS revenue_costed,
           COALESCE(SUM(CASE WHEN l.cost_paise IS NOT NULL THEN l.cost_paise * l.qty END),0) AS cost,
           COUNT(*) AS lines, SUM(CASE WHEN l.cost_paise IS NOT NULL THEN 1 ELSE 0 END) AS costed_lines
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE i.status='completed' AND i.business_date BETWEEN ? AND ?`,
        from,
        to,
      )[0];
      const lines = Number(row.lines);
      const costed = Number(row.costed_lines);
      const exp = Number(all('SELECT COALESCE(SUM(amount_paise),0) s FROM expenses WHERE voided_at IS NULL AND expense_date BETWEEN ? AND ?', from, to)[0].s);
      const gross = Number(row.revenue_costed) - Number(row.cost);
      return {
        title: 'Gross profit',
        description: `${range}. Calculated only from bill lines that carried a valid purchase cost when sold.`,
        columns: [
          { key: 'metric', label: 'Measure', type: 'text' },
          { key: 'value', label: 'Amount', type: 'money' },
        ],
        rows: [
          { metric: 'Net sales on all lines (before tax)', value: Number(row.revenue_all) },
          { metric: 'Net sales on lines with a known cost', value: Number(row.revenue_costed) },
          { metric: 'Cost of goods on those lines', value: Number(row.cost) },
          { metric: 'Gross profit on costed lines', value: gross },
          { metric: 'Expenses in period (not deducted above)', value: exp },
        ],
        notes: [lines ? `Cost data covers ${costed} of ${lines} bill lines (${Math.round((costed / lines) * 100)}%). Profit is understated or unavailable where cost is missing.` : 'No bills in this period.', 'Returns are not netted off this figure.'],
      };
    }
  }
}

/** Flatten a report to a grid for CSV/XLSX export. Money is exported as plain rupee decimals/numbers. */
export function reportToGrid(t: ReportTable, mode: 'csv' | 'xlsx'): (string | number | null)[][] {
  const fmt = (c: ReportColumn, v: string | number | null): string | number | null => {
    if (v === null || v === undefined || v === '') return '';
    if (c.type === 'money') return mode === 'csv' ? paiseToDecimal(Number(v)) : Number(v) / 100;
    if (c.type === 'int') return Number(v);
    if (c.type === 'percent') return Number(v);
    return v;
  };
  const grid: (string | number | null)[][] = [[t.title], t.description ? [t.description] : [], t.columns.map((c) => c.label)];
  for (const r of t.rows) grid.push(t.columns.map((c) => fmt(c, r[c.key] ?? null)));
  if (t.totals) grid.push(t.columns.map((c) => (t.totals![c.key] === undefined ? '' : fmt(c, t.totals![c.key]))));
  for (const n of t.notes ?? []) grid.push([n]);
  return grid.filter((r) => r.length > 0);
}

// ------------------------------------------------------------------ dashboard

export interface DashboardDTO {
  date: string;
  grossPaise: number;
  discountPaise: number;
  netPaise: number;
  taxPaise: number;
  totalPaise: number;
  bills: number;
  averagePaise: number;
  returnsPaise: number;
  cancelledBills: number;
  paymentTotals: { mode: string; netPaise: number }[];
  lowStock: ReturnType<typeof lowStock>;
  recent: { id: number; invoiceNo: string; createdAt: string; totalPaise: number; customerName: string | null; status: string }[];
}

export function dashboard(db: Db, date: string): DashboardDTO {
  const t = db.prepare("SELECT COUNT(*) AS bills, COALESCE(SUM(subtotal_paise),0) AS gross, COALESCE(SUM(discount_paise),0) AS disc, COALESCE(SUM(tax_paise),0) AS tax, COALESCE(SUM(total_paise),0) AS total FROM invoices WHERE status='completed' AND business_date = ?").get(date) as { bills: number; gross: number; disc: number; tax: number; total: number };
  const ret = (db.prepare('SELECT COALESCE(SUM(refund_paise),0) s FROM returns WHERE business_date = ?').get(date) as { s: number }).s;
  const cancelled = (db.prepare("SELECT COUNT(*) c FROM invoices WHERE status='cancelled' AND business_date = ?").get(date) as { c: number }).c;
  const pays = db.prepare("SELECT mode, SUM(CASE WHEN kind='refund' THEN -amount_paise ELSE amount_paise END) AS net FROM payments WHERE business_date = ? GROUP BY mode ORDER BY mode").all(date) as { mode: string; net: number }[];
  const recent = (db.prepare('SELECT id, invoice_no, created_at, total_paise, customer_name, status FROM invoices ORDER BY id DESC LIMIT 8').all() as Record<string, unknown>[]).map((r) => ({ id: r.id as number, invoiceNo: r.invoice_no as string, createdAt: r.created_at as string, totalPaise: r.total_paise as number, customerName: r.customer_name as string | null, status: r.status as string }));
  return {
    date,
    grossPaise: t.gross,
    discountPaise: t.disc,
    netPaise: t.gross - t.disc,
    taxPaise: t.tax,
    totalPaise: t.total,
    bills: t.bills,
    averagePaise: t.bills ? Math.round(t.total / t.bills) : 0,
    returnsPaise: ret,
    cancelledBills: cancelled,
    paymentTotals: pays.map((p) => ({ mode: p.mode, netPaise: p.net })),
    lowStock: lowStock(db, 8),
    recent,
  };
}
