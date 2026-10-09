import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge, Empty, ErrorNote, Loading, Notice, PageHeader, TableWrap, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from '@/components/ui/misc';
import { useAsync } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { formatINR } from '@shared/money';
import { fmtDateTime, shiftDate, todayIST, MODE_LABELS } from '@/lib/utils';
import { InvoiceDetailDialog } from '@/components/invoice/InvoiceDetailDialog';
import type { InvoiceDTO, InvoiceSummary, ReturnDTO } from '@/lib/types';

export function ReturnsPage() {
  const [no, setNo] = useState('');
  const [found, setFound] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const from = shiftDate(todayIST(), -60);
  const rets = useAsync(() => call<{ rows: ReturnDTO[] }>('returns:list', { from, limit: 200 }), []);
  const canc = useAsync(() => call<{ rows: InvoiceSummary[] }>('sales:list', { status: 'cancelled', from, limit: 200 }), []);

  const lookup = async () => {
    setErr(null);
    try {
      const inv = await call<InvoiceDTO>('sales:findByNo', { invoiceNo: no });
      setOpen(inv.id);
      setFound(inv.id);
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <div>
      <PageHeader title="Returns & cancellations" subtitle="Find the original bill, then return items or cancel the whole bill. Reasons are required and everything is audited." />
      <div className="mb-4 flex max-w-xl items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Enter invoice number, e.g. SKP-000123" value={no} onChange={(e) => setNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && no && void lookup()} aria-label="Invoice number" autoFocus />
        </div>
        <Button onClick={() => void lookup()} disabled={!no.trim()}>
          Find bill
        </Button>
      </div>
      {err && <Notice tone="red" className="mb-3 max-w-xl">{err}</Notice>}
      <Tabs defaultValue="returns">
        <TabsList>
          <TabsTrigger value="returns">Returns (last 60 days)</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled bills</TabsTrigger>
        </TabsList>
        <TabsContent value="returns">
          {rets.error ? <ErrorNote error={rets.error} onRetry={rets.reload} /> : !rets.data ? <Loading /> : rets.data.rows.length === 0 ? <Empty>No returns recorded.</Empty> : (
            <TableWrap>
              <thead><tr><Th>Return</Th><Th>Date</Th><Th>Bill</Th><Th>Items</Th><Th>Reason</Th><Th>Refund method</Th><Th right>Refund</Th><Th>By</Th></tr></thead>
              <tbody>
                {rets.data.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(r.invoiceId)}>
                    <Td className="font-medium">{r.returnNo}</Td>
                    <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                    <Td>{r.invoiceNo}</Td>
                    <Td className="text-xs">{r.lines.map((l) => `${l.qty}× ${l.nameEn}${l.restocked ? '' : ' (damaged)'}`).join(', ')}</Td>
                    <Td className="max-w-xs text-xs">{r.reason}</Td>
                    <Td>{MODE_LABELS[r.refundMode] ?? r.refundMode}</Td>
                    <Td num>{formatINR(r.refundPaise)}</Td>
                    <Td>{r.createdBy}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </TabsContent>
        <TabsContent value="cancelled">
          {canc.error ? <ErrorNote error={canc.error} onRetry={canc.reload} /> : !canc.data ? <Loading /> : canc.data.rows.length === 0 ? <Empty>No cancelled bills.</Empty> : (
            <TableWrap>
              <thead><tr><Th>Bill</Th><Th>Date</Th><Th>Cashier</Th><Th right>Total</Th><Th>Status</Th></tr></thead>
              <tbody>
                {canc.data.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(r.id)}>
                    <Td className="font-medium">{r.invoiceNo}</Td>
                    <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                    <Td>{r.cashier}</Td>
                    <Td num>{formatINR(r.totalPaise)}</Td>
                    <Td><Badge tone="red">cancelled</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </TabsContent>
      </Tabs>
      <InvoiceDetailDialog invoiceId={open} onClose={() => { setOpen(null); setFound(null); }} onChanged={() => { rets.reload(); canc.reload(); }} />
      <span className="sr-only">{found}</span>
    </div>
  );
}
