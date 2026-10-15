import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Percent, Plus, ScanBarcode, Trash2, UserRound, Volume2, VolumeX, X } from 'lucide-react';
import { call, ApiError, errMsg } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/toast';
import { useShortcuts, loadShortcuts } from '@/hooks/useShortcuts';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { beep, scanSoundEnabled, setScanSound } from '@/lib/beep';
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
import { cartTotals, type CartLine, type CustomerInput } from './cart';
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
  const [override, setOverride] = useState(false);
  const [approvalFor, setApprovalFor] = useState<{ reason: string; payments: PaymentInput[] } | null>(null);
  const [clearAsk, setClearAsk] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastScan, setLastScan] = useState<{ text: string; ok: boolean } | null>(null);
  const [sound, setSound] = useState(scanSoundEnabled());
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
        if (k) {
          qtyRefs.current[k]?.focus();
          qtyRefs.current[k]?.select();
        }
      },
      selectPayment: openPay,
      completeSale: openPay,
      newBill: () => (done ? newBill() : undefined),
    },
    !payOpen && !done && !override && !approvalFor,
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

  const dialogOpen = payOpen || override || approvalFor !== null || clearAsk;

  // Barcode scanner: add the scanned product wherever the cursor is. A scan after a completed sale starts the next bill.
  useBarcodeScanner((code) => {
    const fail = (text: string) => {
      beep('error');
      setLastScan({ text, ok: false });
    };
    if (dialogOpen) return fail('Close the open window before scanning');
    void call<ProductDTO | null>('products:byCode', { code })
      .then((p) => {
        if (!p) return fail(`Unknown barcode ${code}`);
        if (!p.active) return fail(`${p.nameEn} is inactive and cannot be sold`);
        if (p.pricePaise === null) return fail(`${p.nameEn} has no price`);
        if (done) newBill();
        addProduct(p, 1);
        beep('ok');
        setLastScan({ text: `${p.nameEn} added`, ok: true });
      })
      .catch((e) => fail(errMsg(e)));
  });
  useEffect(() => {
    if (!lastScan) return;
    const t = setTimeout(() => setLastScan(null), 3500);
    return () => clearTimeout(t);
  }, [lastScan]);

  if (!settings || !totals) return null;
  // The discount is decided for the whole bill, not per item: one percentage for every item that is normally discounted.
  const eligible = lines.filter((l) => l.product.effectiveDiscountBp > 0);
  const policyBps = [...new Set(eligible.map((l) => l.product.effectiveDiscountBp))];
  const billPolicyBp = policyBps.length === 1 ? policyBps[0] : null;
  const billOverridden = lines.some((l) => l.overrideBp !== null);
  const noItems = lines.length === 0;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_540px] gap-4">
      <div className="flex min-h-0 flex-col gap-2">
        <div className={cn('flex h-8 shrink-0 items-center justify-between rounded-md border px-3 text-xs', lastScan ? (lastScan.ok ? 'border-primary/40 bg-secondary text-secondary-foreground' : 'border-destructive/40 bg-destructive/10 text-destructive') : 'border-border bg-card text-muted-foreground')} role="status" aria-live="polite" data-testid="scan-status">
          <span className="flex items-center gap-2">
            <ScanBarcode className="h-4 w-4" />
            {lastScan ? lastScan.text : 'Scanner ready - scan any product label, the cursor can be anywhere'}
          </span>
          <button className="flex items-center gap-1 hover:text-foreground" aria-label={sound ? 'Mute scanner beep' : 'Unmute scanner beep'} onClick={() => { setScanSound(!sound); setSound(!sound); }}>
            {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />} {sound ? 'Beep on' : 'Muted'}
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ProductPicker ref={picker} onAdd={addProduct} cartQty={cartQty} refreshKey={refreshKey} />
        </div>
      </div>

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
            <>
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" aria-hidden="true">
              <span className="min-w-0 flex-1">Item</span>
              <span className="w-[6.25rem] shrink-0 text-center">Qty</span>
              <span className="w-[4.5rem] shrink-0 text-right">Price</span>
              <span className="w-[5rem] shrink-0 text-right">Total</span>
              <span className="w-4 shrink-0" />
            </div>
            {lines.map((l, i) => {
              const t = totals.lines[i];
              const over = l.qty > l.product.stockQty;
              return (
                <div key={l.key} onClick={() => setSelected(l.key)} className={cn('flex items-center gap-2 border-b border-border/70 px-3 py-1.5', selected === l.key && 'bg-secondary/60')} data-testid="cart-line">
                  {/* One line per product: item, qty, price, total. */}
                  <div className="min-w-0 flex-1" title={`${l.product.nameEn}${l.product.nameTa ? ` / ${l.product.nameTa}` : ''}`}>
                    <div className="truncate text-sm font-medium">{l.product.nameEn}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button size="icon" variant="outline" className="h-6 w-6" aria-label="Decrease quantity" onClick={() => setQty(l.key, l.qty - 1)} disabled={l.qty <= 1}>
                      <Minus />
                    </Button>
                    <input
                      ref={(el) => {
                        qtyRefs.current[l.key] = el;
                      }}
                      value={l.qty}
                      inputMode="numeric"
                      aria-label={`Quantity of ${l.product.nameEn}`}
                      title={over ? `Beyond stock (${l.product.stockQty})` : undefined}
                      onChange={(e) => setQty(l.key, Number(e.target.value.replace(/\D/g, '')))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') picker.current?.focus();
                      }}
                      onFocus={(e) => e.target.select()}
                      className={cn('num h-6 w-9 rounded-md border bg-card text-center text-sm', over ? 'border-warning text-warning' : 'border-input')}
                    />
                    <Button size="icon" variant="outline" className="h-6 w-6" aria-label="Increase quantity" onClick={() => setQty(l.key, l.qty + 1)}>
                      <Plus />
                    </Button>
                  </div>
                  <div className="num w-[4.5rem] shrink-0 text-right text-xs text-muted-foreground" title={l.product.unit}>
                    × {formatINR(l.product.pricePaise ?? 0)}
                  </div>
                  <div className="num w-[5rem] shrink-0 text-right text-sm font-semibold">{formatINR(t.grossPaise)}</div>
                  <button className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${l.product.nameEn}`} onClick={() => remove(l.key)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            </>
          )}
        </div>

        <div className="border-t border-border bg-muted/40 px-3 py-3">
          <Row label="Subtotal (list)" value={formatINR(totals.subtotalPaise)} />
          <Row
            label="Discount (on total bill)"
            value={totals.discountPaise > 0 ? `−${formatINR(totals.discountPaise)}` : formatINR(0)}
            action={
              eligible.length > 0 || billOverridden ? (
                <button className={cn('flex items-center gap-0.5 text-xs underline-offset-2 hover:underline', billOverridden ? 'text-warning' : 'text-muted-foreground hover:text-foreground')} title="Change the discount for this whole bill" onClick={() => setOverride(true)} data-testid="change-discount">
                  <Percent className="h-3 w-3" /> {billOverridden ? 'changed' : 'change'}
                </button>
              ) : null
            }
          />
          {settings['tax.enabled'] && totals.taxPaise >= 0 && settings['tax.rate_bp'] > 0 && <Row label={`${settings['tax.label']} ${bpToPercent(settings['tax.rate_bp'])}%${settings['tax.inclusive'] ? ' (included)' : ''}`} value={formatINR(totals.taxPaise)} />}
          <div className="flex justify-between py-0.5 text-sm font-semibold" data-testid="cart-qty">
            <span>Total qty</span>
            <span className="num">{lines.reduce((n, l) => n + l.qty, 0)}</span>
          </div>
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
        open={override}
        policyBp={billPolicyBp}
        overridden={billOverridden}
        onClose={() => setOverride(false)}
        onApply={(bp, reason) => setLines((ls) => ls.map((l) => (l.product.effectiveDiscountBp > 0 ? { ...l, overrideBp: bp, overrideReason: bp === null ? '' : reason } : l)))}
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

function Row({ label, value, action }: { label: string; value: string; action?: React.ReactNode }) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {label}
        {action}
      </span>
      <span className="num">{value}</span>
    </div>
  );
}
