import { useState } from 'react';
import { Ban, CircleDollarSign, Printer, Undo2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, ErrorNote, Loading, Notice, TableWrap, Td, Th } from '@/components/ui/misc';
import { useAsync } from '@/hooks/useApi';
import { call } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/toast';
import { formatINR, bpToPercent, parseRupees } from '@shared/money';
import { fmtDateTime, MODE_LABELS } from '@/lib/utils';
import { InvoicePrintDialog } from '@/components/InvoicePrintDialog';
import { ReturnDialog } from './ReturnDialog';
import { useWithApproval } from '@/components/useApproval';
import type { InvoiceDTO, ReturnDTO } from '@/lib/types';

export function InvoiceDetailDialog({ invoiceId, onClose, onChanged }: { invoiceId: number | null; onClose: () => void; onChanged?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const inv = useAsync(() => (invoiceId ? call<InvoiceDTO>('sales:get', { id: invoiceId }) : Promise.resolve(undefined)), [invoiceId]);
  const rets = useAsync(() => (invoiceId ? call<{ rows: ReturnDTO[] }>('returns:list', { invoiceId }) : Promise.resolve(undefined)), [invoiceId]);
  const [print, setPrint] = useState(false);
  const [returning, setReturning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const d = inv.data;
  const refresh = () => {
    inv.reload();
    rets.reload();
    onChanged?.();
  };

  return (
    <>
      <Dialog
        open={invoiceId !== null && !print && !returning && !cancelling && !collecting}
        onOpenChange={(o) => !o && onClose()}
        className="max-w-4xl"
        title={d ? `Invoice ${d.invoiceNo}` : 'Invoice'}
        description={d ? `${fmtDateTime(d.createdAt)} · cashier ${d.cashierName}` : undefined}
        footer={
          d && (
            <>
              {can('billing.reprint') && (
                <Button variant="outline" onClick={() => setPrint(true)}>
                  <Printer /> Print / reprint
                </Button>
              )}
              {d.status === 'completed' && d.duePaise > 0 && can('sales.collect_due') && (
                <Button variant="outline" onClick={() => setCollecting(true)}>
                  <CircleDollarSign /> Collect {formatINR(d.duePaise)}
                </Button>
              )}
              {d.status === 'completed' && (
                <>
                  <Button variant="outline" onClick={() => setReturning(true)} disabled={d.lines.every((l) => l.returnedQty >= l.qty)}>
                    <Undo2 /> Return items
                  </Button>
                  <Button variant="destructive" onClick={() => setCancelling(true)} disabled={(rets.data?.rows.length ?? 0) > 0} title={(rets.data?.rows.length ?? 0) > 0 ? 'Bills with returns cannot be cancelled' : undefined}>
                    <Ban /> Cancel bill
                  </Button>
                </>
              )}
            </>
          )
        }
      >
        {inv.error ? (
          <ErrorNote error={inv.error} onRetry={inv.reload} />
        ) : !d ? (
          <Loading />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={d.status === 'cancelled' ? 'red' : 'green'}>{d.status}</Badge>
              <Badge tone={d.paymentStatus === 'paid' ? 'green' : 'amber'}>{d.paymentStatus === 'paid' ? 'paid' : d.paymentStatus === 'partial' ? `due ${formatINR(d.duePaise)}` : 'unpaid'}</Badge>
              {d.customerName || d.customerPhone ? <span>Customer: {[d.customerName, d.customerPhone].filter(Boolean).join(' · ')}</span> : <span className="text-muted-foreground">Walk-in customer</span>}
            </div>
            {d.status === 'cancelled' && (
              <Notice tone="red">
                Cancelled {d.cancelledAt && fmtDateTime(d.cancelledAt)} - {d.cancelReason}
              </Notice>
            )}
            <TableWrap>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Item</Th>
                  <Th right>Qty</Th>
                  <Th right>Rate</Th>
                  <Th right>Discount</Th>
                  <Th right>Amount</Th>
                  <Th right>Returned</Th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <Td num>{l.lineNo}</Td>
                    <Td>
                      <div className="font-medium">{l.nameEn}</div>
                      <div className="ta text-xs text-muted-foreground">{l.nameTa}</div>
                      {l.discountSource === 'override' && <div className="text-xs text-warning">Discount changed: {l.overrideReason}</div>}
                      {l.stockOverride && <div className="text-xs text-warning">Sold beyond recorded stock</div>}
                    </Td>
                    <Td num>
                      {l.qty} {l.unit}
                    </Td>
                    <Td num>{formatINR(l.ratePaise)}</Td>
                    <Td num>{l.discountPaise ? `${formatINR(l.discountPaise)} (${bpToPercent(l.discountBp)}%)` : '—'}</Td>
                    <Td num>{formatINR(l.netPaise)}</Td>
                    <Td num>{l.returnedQty || ''}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-sm font-semibold">Payments</h3>
                <TableWrap>
                  <tbody>
                    {d.payments.map((p) => (
                      <tr key={p.id}>
                        <Td>
                          {MODE_LABELS[p.mode] ?? p.mode} <span className="text-xs text-muted-foreground">{p.kind === 'refund' ? 'refund' : p.kind === 'due' ? 'pending collected' : ''}</span>
                          {p.reference && <div className="text-xs text-muted-foreground">{p.reference}</div>}
                        </Td>
                        <Td num className={p.kind === 'refund' ? 'text-destructive' : ''}>
                          {p.kind === 'refund' ? '−' : ''}
                          {formatINR(p.amountPaise)}
                          {p.tenderedPaise && p.tenderedPaise > p.amountPaise && <div className="text-xs text-muted-foreground">tendered {formatINR(p.tenderedPaise)}</div>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
                {(rets.data?.rows.length ?? 0) > 0 && (
                  <>
                    <h3 className="mb-1 mt-3 text-sm font-semibold">Returns</h3>
                    <TableWrap>
                      <tbody>
                        {rets.data!.rows.map((r) => (
                          <tr key={r.id}>
                            <Td>
                              {r.returnNo}
                              <div className="text-xs text-muted-foreground">{r.reason}</div>
                            </Td>
                            <Td num>{formatINR(r.refundPaise)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </TableWrap>
                  </>
                )}
              </div>
              <div className="flex flex-col gap-0.5 self-start rounded-lg border border-border p-3 text-sm">
                <Line label="Subtotal" value={formatINR(d.subtotalPaise)} />
                <Line label="Discount" value={`−${formatINR(d.discountPaise)}`} />
                {d.discountRoundingPaise !== 0 && <Line label="  (incl. rounding adjustment)" value={formatINR(d.discountRoundingPaise)} muted />}
                {d.taxEnabled && <Line label={`Tax ${bpToPercent(d.taxRateBp)}%${d.taxInclusive ? ' (included)' : ''}`} value={formatINR(d.taxPaise)} />}
                <div className="mt-1 flex justify-between border-t border-border pt-1 text-base font-semibold">
                  <span>Net payable</span>
                  <span className="num">{formatINR(d.totalPaise)}</span>
                </div>
                <Line label="Paid" value={formatINR(d.paidPaise)} />
                {d.changePaise > 0 && <Line label="Change returned" value={formatINR(d.changePaise)} />}
                {d.refundedPaise > 0 && <Line label="Refunded" value={`−${formatINR(d.refundedPaise)}`} />}
              </div>
            </div>
          </div>
        )}
      </Dialog>
      {d && <InvoicePrintDialog invoiceId={d.id} invoiceNo={d.invoiceNo} open={print} onOpenChange={setPrint} />}
      {d && <ReturnDialog invoice={d} open={returning} onClose={() => setReturning(false)} onDone={refresh} />}
      {d && <CancelDialog invoice={d} open={cancelling} onClose={() => setCancelling(false)} onDone={() => { toast.success('Bill cancelled'); refresh(); }} />}
      {d && <CollectDialog invoice={d} open={collecting} onClose={() => setCollecting(false)} onDone={refresh} />}
    </>
  );
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-xs text-muted-foreground' : ''}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function CancelDialog({ invoice, open, onClose, onDone }: { invoice: InvoiceDTO; open: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const approval = useWithApproval('A supervisor must approve cancelling a bill.');
  const submit = () =>
    approval.run(
      async (a) => {
        setBusy(true);
        setErr(null);
        try {
          await call('sales:cancel', { invoiceId: invoice.id, reason, approval: a ?? null });
          setReason('');
          onClose();
          onDone();
        } finally {
          setBusy(false);
        }
      },
      (m) => setErr(m),
    );
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()} locked={busy} title={`Cancel bill ${invoice.invoiceNo}?`} description="The bill stays in the records marked as cancelled. Stock goes back on the shelf and all payments are reversed." footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Keep bill</Button><Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void submit()}>Cancel this bill</Button></>}>
        <div className="flex flex-col gap-3">
          <Notice tone="amber">This cannot be undone. {formatINR(invoice.paidPaise)} will be recorded as refunded.</Notice>
          <Field label="Reason (required)">
            <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice, customer left" />
          </Field>
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      </Dialog>
      {approval.dialog}
    </>
  );
}

function CollectDialog({ invoice, open, onClose, onDone }: { invoice: InvoiceDTO; open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'cash' | 'upi' | 'card'>('cash');
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const paise = parseRupees(amount);
  const go = async () => {
    try {
      await call('sales:collectDue', { invoiceId: invoice.id, payments: [{ mode, amountPaise: paise }] });
      toast.success('Payment recorded');
      setAmount('');
      onClose();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={`Collect payment - ${invoice.invoiceNo}`} description={`Pending: ${formatINR(invoice.duePaise)}`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!paise || paise <= 0} onClick={() => void go()}>Record payment</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Method">
          <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
          </Select>
        </Field>
        <Field label="Amount received (₹)">
          <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Dialog>
  );
}
