import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Notice, TableWrap, Td, Th } from '@/components/ui/misc';
import { call } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { formatINR, roundDiv } from '@shared/money';
import { newRequestId } from '@/lib/utils';
import { useWithApproval } from '@/components/useApproval';
import type { InvoiceDTO, ReturnDTO } from '@/lib/types';

/** Full or partial return against a completed bill. The bill itself is never edited - a return record is added. */
export function ReturnDialog({ invoice, open, onClose, onDone }: { invoice: InvoiceDTO; open: boolean; onClose: () => void; onDone: (r: ReturnDTO) => void }) {
  const toast = useToast();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [restock, setRestock] = useState<Record<number, boolean>>({});
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'cash' | 'upi' | 'card' | 'credit_note'>('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(newRequestId());
  const approval = useWithApproval('A supervisor must approve returns and refunds.');

  useEffect(() => {
    if (open) {
      setQty({});
      setRestock(Object.fromEntries(invoice.lines.map((l) => [l.id, true])));
      setReason('');
      setErr(null);
      setKey(newRequestId());
    }
  }, [open, invoice]);

  const picked = invoice.lines.map((l) => ({ l, q: Number(qty[l.id] || 0) })).filter((x) => x.q > 0);
  const estimate = picked.reduce((s, { l, q }) => s + roundDiv(l.netPaise * q, l.qty), 0);
  const invalid = picked.some(({ l, q }) => !Number.isInteger(q) || q > l.qty - l.returnedQty);

  const submit = () =>
    approval.run(
      async (a) => {
        setBusy(true);
        setErr(null);
        try {
          const r = await call<ReturnDTO>('returns:create', { clientRequestId: key, invoiceId: invoice.id, reason, refundMode: mode, lines: picked.map(({ l, q }) => ({ invoiceLineId: l.id, qty: q, restock: restock[l.id] !== false })), approval: a ?? null });
          toast.success(`Return ${r.returnNo} recorded - refund ${formatINR(r.refundPaise)}`);
          onDone(r);
          onClose();
        } finally {
          setBusy(false);
        }
      },
      (m) => setErr(m),
    );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && onClose()}
        locked={busy}
        className="max-w-3xl"
        title={`Return items - ${invoice.invoiceNo}`}
        description="Enter the quantity coming back for each line. Refunds use the price the customer actually paid after discount."
        footer={
          <>
            <span className="mr-auto text-sm">
              Estimated refund: <b className="num inline">{formatINR(estimate)}</b>
            </span>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button disabled={busy || picked.length === 0 || invalid || reason.trim().length < 3} onClick={() => void submit()}>
              Record return
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TableWrap>
            <thead>
              <tr>
                <Th>Item</Th>
                <Th right>Sold</Th>
                <Th right>Already returned</Th>
                <Th right>Return qty</Th>
                <Th>Restock?</Th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => {
                const remaining = l.qty - l.returnedQty;
                return (
                  <tr key={l.id}>
                    <Td>
                      <div className="font-medium">{l.nameEn}</div>
                      <div className="ta text-xs text-muted-foreground">{l.nameTa}</div>
                    </Td>
                    <Td num>{l.qty}</Td>
                    <Td num>{l.returnedQty}</Td>
                    <Td right>
                      <Input aria-label={`Return quantity for ${l.nameEn}`} className="ml-auto h-8 w-20" inputMode="numeric" disabled={remaining === 0} value={qty[l.id] ?? ''} placeholder={remaining === 0 ? '—' : `0-${remaining}`} onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value.replace(/\D/g, '') }))} />
                    </Td>
                    <Td>
                      <label className="flex items-center gap-1.5 text-xs">
                        <Checkbox checked={restock[l.id] !== false} onCheckedChange={(v) => setRestock((s) => ({ ...s, [l.id]: v === true }))} /> Back to stock
                      </label>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reason (required)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong item, defective" />
            </Field>
            <Field label="Refund method">
              <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="credit_note">Credit note</option>
              </Select>
            </Field>
          </div>
          <Notice>Items not ticked “Back to stock” (damaged) do not increase stock but are recorded in the stock ledger.</Notice>
          {invalid && <Notice tone="red">A return quantity is larger than what can still be returned.</Notice>}
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      </Dialog>
      {approval.dialog}
    </>
  );
}
