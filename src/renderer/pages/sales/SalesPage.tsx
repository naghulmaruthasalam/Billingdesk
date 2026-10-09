import { useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Empty, ErrorNote, Loading, PageHeader, TableWrap, Td, Th } from '@/components/ui/misc';
import { useAsync, useDebounced } from '@/hooks/useApi';
import { call } from '@/lib/api';
import { formatINR } from '@shared/money';
import { fmtDateTime, shiftDate, todayIST, MODE_LABELS } from '@/lib/utils';
import { InvoiceDetailDialog } from '@/components/invoice/InvoiceDetailDialog';
import type { InvoiceSummary, ProductDTO, UserDTO } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';

const PAGE = 100;

export function SalesPage() {
  const { can } = useAuth();
  const [from, setFrom] = useState(shiftDate(todayIST(), -6));
  const [to, setTo] = useState(todayIST());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [customer, setCustomer] = useState('');
  const [mode, setMode] = useState('');
  const [status, setStatus] = useState('');
  const [cashier, setCashier] = useState('');
  const [productQ, setProductQ] = useState('');
  const [productId, setProductId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const dInvoice = useDebounced(invoiceNo, 250);
  const dCustomer = useDebounced(customer, 250);
  const dProd = useDebounced(productQ, 200);

  const users = useAsync(() => (can('users.manage') ? call<UserDTO[]>('users:list') : Promise.resolve([] as UserDTO[])), []);
  const prods = useAsync(() => (dProd.length >= 2 ? call<{ rows: ProductDTO[] }>('products:list', { search: dProd, limit: 8 }).then((r) => r.rows) : Promise.resolve([] as ProductDTO[])), [dProd]);
  const list = useAsync(
    () => call<{ rows: InvoiceSummary[]; total: number }>('sales:list', { from: from || undefined, to: to || undefined, invoiceNo: dInvoice || undefined, customer: dCustomer || undefined, paymentMode: mode || undefined, status: status || undefined, cashierId: cashier ? Number(cashier) : undefined, productId: productId ?? undefined, limit: PAGE, offset: page * PAGE }),
    [from, to, dInvoice, dCustomer, mode, status, cashier, productId, page],
  );
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const sum = rows.filter((r) => r.status === 'completed').reduce((s, r) => s + r.totalPaise, 0);

  return (
    <div>
      <PageHeader title="Sales history" subtitle="Completed bills are permanent records. Use returns or cancellation to correct them." />
      <div className="mb-3 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] items-end gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} /></Field>
        <Field label="Invoice no."><div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" value={invoiceNo} onChange={(e) => { setInvoiceNo(e.target.value); setPage(0); }} placeholder="SKP-0001" /></div></Field>
        <Field label="Customer"><Input value={customer} onChange={(e) => { setCustomer(e.target.value); setPage(0); }} placeholder="Name or phone" /></Field>
        <Field label="Payment mode">
          <Select value={mode} onChange={(e) => { setMode(e.target.value); setPage(0); }}>
            <option value="">All</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </Field>
        {can('users.manage') && (
          <Field label="Cashier">
            <Select value={cashier} onChange={(e) => { setCashier(e.target.value); setPage(0); }}>
              <option value="">All</option>
              {users.data?.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Product contains">
          <div className="relative">
            <Input value={productId ? (prods.data?.find((p) => p.id === productId)?.nameEn ?? productQ) : productQ} onChange={(e) => { setProductQ(e.target.value); setProductId(null); setPage(0); }} placeholder="Type to find…" />
            {!productId && prods.data && prods.data.length > 0 && (
              <div className="absolute z-20 mt-1 w-64 rounded-md border border-border bg-card shadow-lg">
                {prods.data.map((p) => (
                  <button key={p.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { setProductId(p.id); setProductQ(p.nameEn); }}>
                    {p.nameEn} <span className="ta text-xs text-muted-foreground">{p.nameTa}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <Button variant="outline" onClick={() => { setInvoiceNo(''); setCustomer(''); setMode(''); setStatus(''); setCashier(''); setProductId(null); setProductQ(''); setPage(0); }}>Clear filters</Button>
      </div>
      {list.error ? (
        <ErrorNote error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No bills match these filters.</Empty>
      ) : (
        <>
          <TableWrap maxHeight="calc(100vh - 330px)">
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Date & time</Th>
                <Th>Cashier</Th>
                <Th>Customer</Th>
                <Th>Payment</Th>
                <Th right>Discount</Th>
                <Th right>Total</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(r.id)} data-testid="sales-row">
                  <Td className="font-medium">{r.invoiceNo}</Td>
                  <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                  <Td>{r.cashier}</Td>
                  <Td>{r.customerName ?? <span className="text-muted-foreground">Walk-in</span>} <span className="text-xs text-muted-foreground">{r.customerPhone}</span></Td>
                  <Td>{r.modes.split(',').filter(Boolean).map((m) => MODE_LABELS[m] ?? m).join(' + ')}</Td>
                  <Td num>{r.discountPaise ? formatINR(r.discountPaise) : '—'}</Td>
                  <Td num className={r.status === 'cancelled' ? 'line-through opacity-60' : ''}>{formatINR(r.totalPaise)}</Td>
                  <Td className="whitespace-nowrap">
                    {r.status === 'cancelled' ? <Badge tone="red">cancelled</Badge> : <Badge tone="green">completed</Badge>}{' '}
                    {r.paymentStatus !== 'paid' && r.status === 'completed' && <Badge tone="amber">{r.paymentStatus}</Badge>}{' '}
                    {r.returnedPaise > 0 && <Badge tone="gold">returned {formatINR(r.returnedPaise)}</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total} bills · page total of completed bills: <b className="num inline text-foreground">{formatINR(sum)}</b>
            </span>
            <span className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE))}
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </span>
          </div>
        </>
      )}
      <InvoiceDetailDialog invoiceId={open} onClose={() => setOpen(null)} onChanged={list.reload} />
    </div>
  );
}
