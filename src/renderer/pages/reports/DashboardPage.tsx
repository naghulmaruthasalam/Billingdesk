import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge, Card, Empty, ErrorNote, Loading, PageHeader, Stat, TableWrap, Td, Th } from '@/components/ui/misc';
import { MoneyBars } from '@/components/MoneyChart';
import { InvoiceDetailDialog } from '@/components/invoice/InvoiceDetailDialog';
import { useAsync } from '@/hooks/useApi';
import { call } from '@/lib/api';
import { formatINR } from '@shared/money';
import { fmtDate, fmtDateTime, shiftDate, todayIST, MODE_LABELS } from '@/lib/utils';
import type { DashboardDTO, ReportTable } from '@/lib/types';

export function DashboardPage() {
  const dash = useAsync(() => call<DashboardDTO>('dashboard:get', {}), []);
  const week = useAsync(() => call<ReportTable>('reports:run', { name: 'sales_summary', from: shiftDate(todayIST(), -6), to: todayIST(), groupBy: 'day' }), []);
  const [open, setOpen] = useState<number | null>(null);
  const d = dash.data;
  const chart = (week.data?.rows ?? []).map((r) => ({ day: String(r.period).slice(5), net: r.net }));
  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Today, ${fmtDate(todayIST())}. Sales figures exclude cancelled bills; “net sales” is revenue after discount, not profit.`} />
      {dash.error ? <ErrorNote error={dash.error} onRetry={dash.reload} /> : !d ? <Loading /> : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
            <Stat label="Gross sales (list price)" value={formatINR(d.grossPaise)} />
            <Stat label="Discounts given" value={formatINR(d.discountPaise)} />
            <Stat label="Net sales (before tax)" value={formatINR(d.netPaise)} tone="good" />
            <Stat label="Completed bills" value={d.bills} sub={d.cancelledBills ? `${d.cancelledBills} cancelled` : undefined} />
            <Stat label="Average bill" value={formatINR(d.averagePaise)} />
            <Stat label="Returns refunded" value={formatINR(d.returnsPaise)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Net sales, last 7 days</h2>
              {week.data && chart.length > 0 ? <MoneyBars data={chart} xKey="day" yKey="net" label="Net sales" /> : <Empty>No sales in the last 7 days.</Empty>}
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Collected today by payment mode</h2>
              {d.paymentTotals.length === 0 ? <Empty>No payments yet today.</Empty> : (
                <ul className="flex flex-col gap-1.5">
                  {d.paymentTotals.map((p) => (
                    <li key={p.mode} className="flex items-center justify-between rounded-md border border-border px-3 py-2"><span>{MODE_LABELS[p.mode] ?? p.mode}</span><span className="num font-semibold">{formatINR(p.netPaise)}</span></li>
                  ))}
                  <li className="mt-1 flex items-center justify-between px-3 text-xs text-muted-foreground"><span>Net of refunds; cash excludes change returned</span></li>
                </ul>
              )}
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-warning" /> Low stock</h2>
              {d.lowStock.length === 0 ? <Empty>No products at or below their minimum.</Empty> : (
                <TableWrap><tbody>{d.lowStock.map((p) => <tr key={p.id}><Td><div className="font-medium">{p.nameEn}</div><div className="ta text-xs text-muted-foreground">{p.nameTa}</div></Td><Td num><Badge tone={p.stockQty <= 0 ? 'red' : 'amber'}>{p.stockQty} {p.unit}</Badge></Td></tr>)}</tbody></TableWrap>
              )}
            </Card>
            <Card className="p-4">
              <h2 className="mb-2 text-sm font-semibold">Recent transactions</h2>
              {d.recent.length === 0 ? <Empty>No bills yet.</Empty> : (
                <TableWrap>
                  <thead><tr><Th>Invoice</Th><Th>Time</Th><Th right>Total</Th></tr></thead>
                  <tbody>{d.recent.map((r) => <tr key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(r.id)}><Td className="font-medium">{r.invoiceNo} {r.status === 'cancelled' && <Badge tone="red">cancelled</Badge>}</Td><Td className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</Td><Td num>{formatINR(r.totalPaise)}</Td></tr>)}</tbody>
                </TableWrap>
              )}
            </Card>
          </div>
        </div>
      )}
      <InvoiceDetailDialog invoiceId={open} onClose={() => setOpen(null)} onChanged={dash.reload} />
    </div>
  );
}
