import { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CreditCard, QrCode, Split } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Kbd, Notice } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { formatINR, paiseToDecimal, parseRupees } from '@shared/money';
import { settlePayments, type PaymentInput, type PaymentMode } from '@shared/pricing';
import { renderInvoiceHtml } from '@shared/invoiceHtml';
import { loadShortcuts, useShortcuts } from '@/hooks/useShortcuts';
import { useAuth } from '@/hooks/useAuth';
import type { InvoiceTotals } from '@shared/pricing';
import { draftInvoice, type CartLine, type CustomerInput } from './cart';

type Method = 'cash' | 'upi' | 'card' | 'split';

const METHODS: { id: Method; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'upi', label: 'UPI', icon: QrCode },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'split', label: 'Split', icon: Split },
];

export function PaymentDialog({ open, onOpenChange, lines, totals, customer, busy, error, onComplete }: { open: boolean; onOpenChange: (o: boolean) => void; lines: CartLine[]; totals: InvoiceTotals; customer: CustomerInput; busy: boolean; error: string | null; onComplete: (payments: PaymentInput[]) => void }) {
  const { settings, user } = useAuth();
  const total = totals.totalPaise;
  const allowDue = settings?.['billing.allow_credit'] ?? false;
  const [method, setMethod] = useState<Method>('cash');
  const [received, setReceived] = useState('');
  const [ref, setRef] = useState('');
  const [split, setSplit] = useState<Record<PaymentMode, string>>({ cash: '', upi: '', card: '' });
  const methodRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMethod('cash');
      setReceived(paiseToDecimal(total));
      setRef('');
      setSplit({ cash: '', upi: '', card: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const payments = useMemo<PaymentInput[]>(() => {
    if (method === 'cash') {
      const a = parseRupees(received);
      return a && a > 0 ? [{ mode: 'cash', amountPaise: a }] : [];
    }
    if (method === 'upi' || method === 'card') return total > 0 ? [{ mode: method, amountPaise: total, reference: ref.trim() || null }] : [];
    return (['cash', 'upi', 'card'] as PaymentMode[]).flatMap((m) => {
      const a = parseRupees(split[m]);
      return a && a > 0 ? [{ mode: m, amountPaise: a, reference: m === 'cash' ? null : ref.trim() || null }] : [];
    });
  }, [method, received, ref, split, total]);

  const settlement = useMemo(() => {
    try {
      return { s: settlePayments(total, payments, allowDue), err: null as string | null };
    } catch (e) {
      return { s: null, err: e instanceof Error ? e.message : String(e) };
    }
  }, [total, payments, allowDue]);

  const canComplete = !!settlement.s && (total === 0 || payments.length > 0) && !busy;
  const confirm = () => {
    if (canComplete) onComplete(payments);
  };
  useShortcuts({ completeSale: confirm, selectPayment: () => methodRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus() }, open);

  const preview = useMemo(() => {
    if (!open || !settings) return '';
    const html = renderInvoiceHtml(draftInvoice(lines, totals, settings, payments, user?.displayName ?? '', customer), {
      nameEn: settings['shop.name_en'],
      nameTa: settings['shop.name_ta'],
      address: settings['shop.address'],
      addressTa: settings['shop.address_ta'],
      phones: settings['shop.phones'],
      taxId: settings['shop.tax_id'],
      logoDataUrl: settings['shop.logo_data_url'],
      footerEn: settings['invoice.footer_en'],
      footerTa: settings['invoice.footer_ta'],
      taxLabel: settings['tax.label'],
      showTamil: settings['invoice.show_tamil'],
    }, { size: '80mm', fontBase: './fonts' });
    return html;
  }, [open, lines, totals, settings, payments, user, customer]);

  const quick = [total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, 200000, 50000].filter((v, i, a) => v >= total && a.indexOf(v) === i).slice(0, 5);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      locked={busy}
      className="max-w-4xl"
      title="Payment"
      description="Choose how the customer is paying, review the bill preview, then complete the sale."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Back to bill
          </Button>
          <Button size="lg" onClick={confirm} disabled={!canComplete} data-testid="complete-sale">
            {busy ? 'Saving…' : 'Complete sale'} <Kbd>{loadShortcuts().completeSale}</Kbd>
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-secondary px-4 py-3">
            <div className="text-xs text-muted-foreground">Amount payable</div>
            <div className="num !text-left text-3xl font-semibold text-primary" data-testid="payable">
              {formatINR(total)}
            </div>
            {totals.discountPaise > 0 && (
              <div className="text-xs text-muted-foreground">
                List {formatINR(totals.subtotalPaise)} − discount {formatINR(totals.discountPaise)}
                {totals.taxPaise > 0 ? ` + ${settings?.['tax.label']} ${formatINR(totals.taxPaise)}` : ''}
              </div>
            )}
          </div>
          <div ref={methodRef} role="radiogroup" aria-label="Payment method" className="grid grid-cols-4 gap-2">
            {METHODS.map(({ id, label, icon: Icon }) => (
              <button key={id} role="radio" aria-checked={method === id} onClick={() => setMethod(id)} className={cn('flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 text-sm font-medium', method === id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted')}>
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>

          {method === 'cash' && (
            <div className="flex flex-col gap-2">
              <Field label="Cash received (₹)">
                <Input autoFocus inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} onFocus={(e) => e.target.select()} className="h-11 text-lg" aria-label="Cash received" />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {quick.map((q) => (
                  <Button key={q} size="sm" variant="outline" onClick={() => setReceived(paiseToDecimal(q))}>
                    {q === total ? 'Exact' : formatINR(q)}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {(method === 'upi' || method === 'card') && (
            <Field label={method === 'upi' ? 'UPI reference / UTR (optional)' : 'Card slip / approval code (optional)'}>
              <Input autoFocus value={ref} onChange={(e) => setRef(e.target.value)} />
            </Field>
          )}
          {method === 'split' && (
            <div className="flex flex-col gap-2">
              {(['cash', 'upi', 'card'] as PaymentMode[]).map((m) => (
                <Field key={m} label={`${m === 'cash' ? 'Cash received' : m.toUpperCase()} (₹)`}>
                  <Input inputMode="decimal" value={split[m]} onChange={(e) => setSplit((s) => ({ ...s, [m]: e.target.value }))} aria-label={`${m} amount`} />
                </Field>
              ))}
              <Field label="Reference for UPI / card (optional)">
                <Input value={ref} onChange={(e) => setRef(e.target.value)} />
              </Field>
            </div>
          )}

          {settlement.err ? (
            <Notice tone="amber">{payments.length === 0 ? 'Enter the amount received.' : settlement.err}</Notice>
          ) : settlement.s ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border border-border px-3 py-2">
                <div className="text-xs text-muted-foreground">Received</div>
                <div className="num !text-left font-semibold">{formatINR(payments.reduce((a, p) => a + p.amountPaise, 0))}</div>
              </div>
              <div className={cn('rounded-md border px-3 py-2', settlement.s.changePaise > 0 ? 'border-accent bg-warning-bg' : 'border-border')}>
                <div className="text-xs text-muted-foreground">{settlement.s.duePaise > 0 ? 'Balance due' : 'Change to return'}</div>
                <div className="num !text-left text-lg font-semibold" data-testid="change-due">
                  {formatINR(settlement.s.duePaise > 0 ? settlement.s.duePaise : settlement.s.changePaise)}
                </div>
              </div>
            </div>
          ) : null}
          {error && <Notice tone="red">{error}</Notice>}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Bill preview (draft)</div>
          <iframe title="Bill preview" sandbox="" srcDoc={preview} className="h-[52vh] w-full rounded border border-border bg-white" />
        </div>
      </div>
    </Dialog>
  );
}
