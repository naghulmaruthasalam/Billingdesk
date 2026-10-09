import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Percent, Plus, Trash2, UserRound, X } from 'lucide-react';
import { call, ApiError, errMsg } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/toast';
import { useShortcuts, loadShortcuts } from '@/hooks/useShortcuts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Badge, Kbd, Notice } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ApprovalDialog } from '@/components/ApprovalDialog';
import { cn, newRequestId } from '@/lib/utils';
import { formatINR, bpToPercent } from '@shared/money';
import type { PaymentInput } from '@shared/pricing';
import type { Approval, CustomerDTO, InvoiceDTO, ProductDTO } from '@/lib/types';
import { ProductPicker, type PickerHandle } from './ProductPicker';
import { cartTotals, lineDiscountBp, type CartLine, type CustomerInput } from './cart';
import { OverrideDialog } from './OverrideDialog';
import { PaymentDialog } from './PaymentDialog';
import { SaleDoneDialog } from './SaleDoneDialog';
import { useNavigate } from 'react-router-dom';

export function PosPage() {
  const { settings, user, can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const picker = useRef<PickerHandle>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerInput>({ name: '', phone: '' });
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [done, setDone] = useState<InvoiceDTO | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [approvalFor, setApprovalFor] = useState<{ reason: string; payments: PaymentInput[] } | null>(null);
  const [clearAsk, setClearAsk] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef(newRequestId());
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const totals = useMemo(() => (settings ? cartTotals(lines, settings) : null), [lines, settings]);

  const addProduct = useCallback(
    (p: ProductDTO, qty: number) => {
      setLines((ls) => {
        const existing = ls.find((l) => l.product.id === p.id && l.overrideBp === null);
        if (existing) {
          setSelected(existing.key);
          return ls.map((l) => (l === existing ? { ...l, qty: Math.min(l.qty + qty, 100000) } : l));
        }
        const key = newRequestId();
        setSelected(key);
        return [...ls, { key, product: p, qty, overrideBp: null, overrideReason: '' }];
      });
    },
    [],
  );

  const setQty = (key: string, qty: number) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: Math.max(1, Math.min(100000, Math.floor(qty) || 1)) } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const cartQty = (id: number) => lines.filter((l) => l.product.id === id).reduce((s, l) => s + l.qty, 0);

  const newBill = useCallback(() => {
    setLines([]);
    setSelected(null);
    setCustomer({ name: '', phone: '' });
    setDone(null);
    setPayOpen(false);
    setPayError(null);
    setApprovalFor(null);
    requestId.current = newRequestId();
    setRefreshKey((k) => k + 1);
    setTimeout(() => picker.current?.focus(), 50);
  }, []);

  const openPay = useCallback(() => {
    if (lines.length === 0) return toast.info('Add at least one item first');
    setPayError(null);
    setPayOpen(true);
  }, [lines.length, toast]);

  useShortcuts(
    {
      focusSearch: () => picker.current?.focus(),
      editLine: () => {
        const k = selected ?? lines[lines.length - 1]?.key;
        if (k) qtyRefs.current[k]?.focus(), qtyRefs.current[k]?.select();
      },
      selectPayment: openPay,
      completeSale: openPay,
      newBill: () => (done ? newBill() : undefined),
    },
    !payOpen && !done && override === null && !approvalFor,
  );

  // Look up an existing customer when a full phone number is typed.
  useEffect(() => {
    const phone = customer.phone.replace(/\D/g, '');
    if (phone.length < 10 || customer.name) return;
    let alive = true;
    call<{ rows: CustomerDTO[] }>('customers:list', { search: customer.phone.trim(), limit: 3 })
      .then((r) => {
        const hit = r.rows.find((c) => (c.phone ?? '').replace(/\D/g, '') === phone);
        if (alive && hit) setCustomer((c) => (c.name ? c : { ...c, name: hit.name }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [customer.phone, customer.name]);

  const complete = async (payments: PaymentInput[], approval?: Approval) => {
    setBusy(true);
    setPayError(null);
    try {
      const inv = await call<InvoiceDTO>('billing:create', {
        clientRequestId: requestId.current,
        customer: customer.name.trim() || customer.phone.trim() ? { name: customer.name.trim() || null, phone: customer.phone.trim() || null } : null,
        lines: lines.map((l) => ({
          productId: l.product.id,
          qty: l.qty,
          discountOverrideBp: l.overrideBp,
          overrideReason: l.overrideBp !== null ? l.overrideReason : null,
          stockOverride: l.qty > l.product.stockQty,
        })),
        payments: payments.map((p) => ({ mode: p.mode, amountPaise: p.amountPaise, reference: p.reference ?? null })),
        approval: approval ?? null,
      });
      setPayOpen(false);
      setApprovalFor(null);
      setDone(inv);
    } catch (e) {
      if (e instanceof ApiError && e.needsApproval) {
        const perm = (e.details as { permission?: string }).permission;
        setApprovalFor({ payments, reason: perm === 'billing.stock_override' ? 'This bill sells more than the stock on record. A supervisor must approve selling beyond stock.' : 'This bill changes a discount away from the shop policy. A supervisor must approve it.' });
      } else {
        setPayError(errMsg(e));
        if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') setRefreshKey((k) => k + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!settings || !totals) return null;
  const overrideLine = lines.find((l) => l.key === override) ?? null;
  const noItems = lines.length === 0;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_440px] gap-4">
      <ProductPicker ref={picker} onAdd={addProduct} cartQty={cartQty} refreshKey={refreshKey} />

      <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card" aria-label="Current bill">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="font-semibold">Current bill</div>
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{user?.displayName}</Badge>
            <Button size="sm" variant="ghost" disabled={noItems} onClick={() => setClearAsk(true)}>
              <X /> Clear
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-border px-3 py-2">
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-8 text-xs" placeholder="Customer name (optional)" value={customer.name} onChange={(e) => setCustomer((c) => ({ ...c, name: e.target.value }))} aria-label="Customer name" />
          </div>
          <Input className="h-8 text-xs" placeholder="Phone (optional)" inputMode="tel" value={customer.phone} onChange={(e) => setCustomer((c) => ({ ...c, phone: e.target.value }))} aria-label="Customer phone" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {noItems ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
              <div className="font-medium text-foreground">No items yet</div>
              Search or click a product to add it. Press <Kbd>{loadShortcuts().focusSearch}</Kbd> to search.
            </div>
          ) : (
            lines.map((l, i) => {
              const t = totals.lines[i];
              const bp = lineDiscountBp(l);
              const over = l.qty > l.product.stockQty;
              return (
                <div key={l.key} onClick={() => setSelected(l.key)} className={cn('border-b border-border/70 px-3 py-2', selected === l.key && 'bg-secondary/60')} data-testid="cart-line">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{l.product.nameEn}</div>
                      <div className="ta truncate text-xs text-muted-foreground">{l.product.nameTa}</div>
                    </div>
                    <button className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${l.product.nameEn}`} onClick={() => remove(l.key)}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Decrease quantity" onClick={() => setQty(l.key, l.qty - 1)} disabled={l.qty <= 1}>
                        <Minus />
                      </Button>
                      <input
                        ref={(el) => {
                          qtyRefs.current[l.key] = el;
                        }}
                        value={l.qty}
                        inputMode="numeric"
                        aria-label={`Quantity of ${l.product.nameEn}`}
                        onChange={(e) => setQty(l.key, Number(e.target.value.replace(/\D/g, '')))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') picker.current?.focus();
                        }}
                        onFocus={(e) => e.target.select()}
                        className="num h-7 w-12 rounded-md border border-input bg-card text-center text-sm"
                      />
                      <Button size="icon" variant="outline" className="h-7 w-7" aria-label="Increase quantity" onClick={() => setQty(l.key, l.qty + 1)}>
                        <Plus />
                      </Button>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {l.product.unit} × {formatINR(l.product.pricePaise ?? 0)}
                      </span>
                    </div>
                    <div className="text-right">
                      {t.discountPaise > 0 && <div className="num text-xs text-muted-foreground line-through">{formatINR(t.grossPaise)}</div>}
                      <div className="num font-semibold">{formatINR(t.netPaise)}</div>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      {bp > 0 ? (
                        <Badge tone={l.overrideBp !== null ? 'gold' : 'green'}>
                          {bpToPercent(bp)}% off −{formatINR(t.discountPaise)}
                          {l.overrideBp !== null ? ' (changed)' : ''}
                        </Badge>
                      ) : (
                        <Badge tone={l.overrideBp !== null ? 'gold' : 'neutral'}>No discount{l.overrideBp !== null ? ' (changed)' : ''}</Badge>
                      )}
                      <button className="flex items-center gap-0.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setOverride(l.key)}>
                        <Percent className="h-3 w-3" /> change
                      </button>
                    </div>
                    {over && <span className="text-warning">Beyond stock ({l.product.stockQty})</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-border bg-muted/40 px-3 py-3">
          <Row label="Subtotal (list)" value={formatINR(totals.subtotalPaise)} />
          <Row label="Discount" value={totals.discountPaise > 0 ? `−${formatINR(totals.discountPaise)}` : formatINR(0)} />
          {settings['tax.enabled'] && totals.taxPaise >= 0 && settings['tax.rate_bp'] > 0 && <Row label={`${settings['tax.label']} ${bpToPercent(settings['tax.rate_bp'])}%${settings['tax.inclusive'] ? ' (included)' : ''}`} value={formatINR(totals.taxPaise)} />}
          <div className="mt-1 flex items-baseline justify-between border-t border-border pt-2">
            <span className="text-sm font-medium">Payable</span>
            <span className="num text-2xl font-semibold text-primary" data-testid="cart-total">
              {formatINR(totals.totalPaise)}
            </span>
          </div>
          <Button size="lg" className="mt-3 w-full" disabled={noItems} onClick={openPay} data-testid="pay">
            Pay <Kbd>{loadShortcuts().completeSale}</Kbd>
          </Button>
          {!can('billing.create') && <Notice tone="red" className="mt-2">You do not have permission to create bills.</Notice>}
        </div>
      </div>

      <OverrideDialog
        line={overrideLine}
        onClose={() => setOverride(null)}
        onApply={(bp, reason) => setLines((ls) => ls.map((l) => (l.key === override ? { ...l, overrideBp: bp, overrideReason: reason } : l)))}
      />
      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} lines={lines} totals={totals} customer={customer} busy={busy} error={payError} onComplete={(p) => void complete(p)} />
      <ApprovalDialog
        open={approvalFor !== null}
        onOpenChange={(o) => !o && setApprovalFor(null)}
        reason={approvalFor?.reason ?? ''}
        onApproved={(a) => {
          if (approvalFor) void complete(approvalFor.payments, a);
        }}
      />
      <SaleDoneDialog invoice={done} onNewBill={newBill} />
      <ConfirmDialog
        open={clearAsk}
        onOpenChange={setClearAsk}
        title="Clear this bill?"
        description="All items on the current bill will be removed. Nothing has been saved yet."
        confirmLabel="Clear bill"
        destructive
        onConfirm={() => {
          setClearAsk(false);
          newBill();
        }}
      />
      {settings && !(settings['setup.catalogue_approved']) && (
        <div className="fixed bottom-4 left-72 z-40 max-w-md">
          <Notice>
            Billing is locked until the owner approves the product catalogue.{' '}
            <button className="underline" onClick={() => nav('/products?tab=review')}>
              Go to catalogue review
            </button>
          </Notice>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
