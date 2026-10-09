import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Empty, ErrorNote, Loading, Notice, PageHeader, TableWrap, Td, Th, Card } from '@/components/ui/misc';
import { MoneyBars } from '@/components/MoneyChart';
import { useAsync } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { saveFileResult } from '@/lib/files';
import { useToast } from '@/components/ui/toast';
import { formatINR } from '@shared/money';
import { shiftDate, startOfMonth, startOfWeek, todayIST } from '@/lib/utils';
import type { FileResult, ReportColumn, ReportTable } from '@/lib/types';

const REPORTS = [
  ['sales_summary', 'Sales summary (daily / weekly / monthly)'],
  ['sales_by_product', 'Sales by product'],
  ['sales_by_category', 'Sales by category'],
  ['sales_by_cashier', 'Sales by cashier'],
  ['payment_reconciliation', 'Cash / UPI / card reconciliation'],
  ['discounts', 'Discounts granted'],
  ['returns_cancellations', 'Returns and cancellations'],
  ['stock_movements', 'Stock movements'],
  ['stock_valuation', 'Stock valuation'],
  ['low_stock', 'Low stock'],
  ['expenses', 'Expenses'],
  ['profit', 'Gross profit (where cost is known)'],
] as const;

const PRESETS: [string, () => [string, string]][] = [
  ['Today', () => [todayIST(), todayIST()]],
  ['Yesterday', () => [shiftDate(todayIST(), -1), shiftDate(todayIST(), -1)]],
  ['This week', () => [startOfWeek(todayIST()), todayIST()]],
  ['This month', () => [startOfMonth(todayIST()), todayIST()]],
  ['Last 30 days', () => [shiftDate(todayIST(), -29), todayIST()]],
];

function cell(c: ReportColumn, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if (c.type === 'money') return formatINR(Number(v));
  if (c.type === 'int') return Number(v).toLocaleString('en-IN');
  if (c.type === 'percent') return `${v}%`;
  return String(v);
}

export function ReportsPage() {
  const toast = useToast();
  const [name, setName] = useState<(typeof REPORTS)[number][0]>('sales_summary');
  const [from, setFrom] = useState(startOfMonth(todayIST()));
  const [to, setTo] = useState(todayIST());
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const rep = useAsync(() => call<ReportTable>('reports:run', { name, from, to, groupBy }), [name, from, to, groupBy]);
  const t = rep.data;

  const exportAs = async (format: 'csv' | 'xlsx') => {
    try {
      const f = await call<FileResult>('reports:export', { name, from, to, groupBy, format });
      const s = await saveFileResult(f);
      if (s.saved) toast.success(`Saved ${s.path}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const chartRows = t && (name === 'sales_summary' ? t.rows.map((r) => ({ x: String(r.period), y: r.net })) : name === 'sales_by_category' ? t.rows.map((r) => ({ x: String(r.category), y: r.net })) : null);

  return (
    <div>
      <PageHeader title="Reports" subtitle="Revenue, collections, discounts, tax, refunds and profit are shown separately. Net sales is not profit." actions={<><Button variant="outline" onClick={() => void exportAs('csv')}><Download /> CSV</Button><Button variant="outline" onClick={() => void exportAs('xlsx')}><Download /> Excel</Button></>} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Report"><Select className="w-72" value={name} onChange={(e) => setName(e.target.value as typeof name)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {name === 'sales_summary' && <Field label="Group by"><Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></Select></Field>}
        <div className="flex flex-wrap gap-1">{PRESETS.map(([l, fn]) => <Button key={l} size="sm" variant="outline" onClick={() => { const [a, b] = fn(); setFrom(a); setTo(b); }}>{l}</Button>)}</div>
      </div>
      {rep.error ? <ErrorNote error={rep.error} onRetry={rep.reload} /> : !t ? <Loading /> : (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">{t.title}</h2>
            {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
          </div>
          {chartRows && chartRows.length > 0 && <Card className="p-3"><MoneyBars data={chartRows} xKey="x" yKey="y" label="Net sales" height={name === 'sales_by_category' ? Math.max(180, chartRows.length * 32) : 220} horizontal={name === 'sales_by_category'} /></Card>}
          {t.rows.length === 0 && !t.totals ? <Empty>No data for this period.</Empty> : (
            <TableWrap maxHeight="calc(100vh - 360px)">
              <thead><tr>{t.columns.map((c) => <Th key={c.key} right={c.type !== 'text'}>{c.label}</Th>)}</tr></thead>
              <tbody>
                {t.rows.map((r, i) => (
                  <tr key={i}>{t.columns.map((c) => <Td key={c.key} num={c.type !== 'text'} className={c.key === 'name_ta' ? 'ta' : undefined}>{cell(c, r[c.key])}</Td>)}</tr>
                ))}
                {t.totals && <tr className="bg-muted font-semibold">{t.columns.map((c) => <Td key={c.key} num={c.type !== 'text'}>{cell(c, t.totals![c.key])}</Td>)}</tr>}
              </tbody>
            </TableWrap>
          )}
          {t.notes?.map((n, i) => <Notice key={i} tone="green">{n}</Notice>)}
        </div>
      )}
    </div>
  );
}
