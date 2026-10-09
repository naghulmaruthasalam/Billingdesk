import { useState } from 'react';
import { CheckCheck, CircleCheck, RotateCcw, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Empty, ErrorNote, Loading, Notice, TableWrap, Td, Th } from '@/components/ui/misc';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { useAsync } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { formatINR } from '@shared/money';
import type { CatalogueStatus, ProductDTO } from '@/lib/types';
import { useOutletContext } from 'react-router-dom';

/**
 * Catalogue review: the printed list was transcribed from photographs, so uncertain entries are flagged. Billing stays
 * locked until the owner has confirmed (or corrected) every flagged entry and approved the catalogue.
 */
export function ReviewTab({ onEdit, onChanged }: { onEdit: (p: ProductDTO) => void; onChanged: () => void }) {
  const toast = useToast();
  const { can, reloadSettings } = useAuth();
  const ctx = useOutletContext<{ refreshStatus: () => void } | null>();
  const status = useAsync(() => call<CatalogueStatus>('catalogue:status'), []);
  const list = useAsync(() => call<{ rows: ProductDTO[] }>('products:list', { reviewOnly: true }), []);
  const changed = useAsync(() => call<{ rows: ProductDTO[] }>('products:list', {}).then((r) => r.rows.filter((p) => p.printedPricePaise !== null && p.pricePaise !== p.printedPricePaise)), []);
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const reloadAll = () => {
    status.reload();
    list.reload();
    changed.reload();
    onChanged();
    ctx?.refreshStatus();
    void reloadSettings();
  };

  const verify = async (ids: number[]) => {
    setBusy(true);
    try {
      await call('catalogue:markReviewed', { ids });
      reloadAll();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = async (approved: boolean) => {
    setBusy(true);
    try {
      await call('catalogue:approve', { approved });
      toast.success(approved ? 'Catalogue approved. Billing is now enabled.' : 'Catalogue approval withdrawn. Billing is locked.');
      reloadAll();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setResetErr(null);
    try {
      const r = await call<{ restored: number }>('catalogue:reset', { confirmPassword: pw });
      toast.success(`Restored ${r.restored} entries to the printed list. Sales history and stock were not touched.`);
      setResetOpen(false);
      setPw('');
      reloadAll();
    } catch (e) {
      setResetErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const st = status.data;
  const rows = list.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      {status.error ? <ErrorNote error={status.error} onRetry={status.reload} /> : null}
      {st && (
        <div className="grid gap-3 md:grid-cols-3">
          <Step ok={st.needsReview === 0} title="1. Check flagged entries" text={st.needsReview === 0 ? 'All flagged entries confirmed.' : `${st.needsReview} entries need your confirmation.`} />
          <Step ok={st.addressConfirmed} title="2. Confirm shop details" text={st.addressConfirmed ? 'Name, address and phones confirmed.' : 'Open Settings → Shop details and confirm the transcribed address.'} />
          <Step ok={st.approved} title="3. Approve catalogue" text={st.approved ? 'Billing is enabled.' : 'Approve once prices and names match the printed list.'} />
        </div>
      )}
      <Notice>
        Names, Tamil text and rates were transcribed from photographs of the 2025 printed list. Compare each flagged entry with the paper list, correct anything that is wrong, then mark it verified. Original printed rates are kept and shown below whenever a rate is changed.
      </Notice>
      {st && (
        <div className="flex flex-wrap items-center gap-2">
          {can('catalogue.approve') && (
            <>
              <Button disabled={busy || st.approved || st.needsReview > 0 || st.missingPrice > 0} onClick={() => void approve(true)} data-testid="approve-catalogue">
                <CircleCheck /> Approve catalogue for billing
              </Button>
              {st.approved && (
                <Button variant="outline" disabled={busy} onClick={() => void approve(false)}>
                  Withdraw approval
                </Button>
              )}
              <Button variant="outline" disabled={busy || rows.length === 0} onClick={() => setConfirmAll(true)}>
                <CheckCheck /> Mark all {rows.length} as verified
              </Button>
              <Button variant="ghost" className="ml-auto" onClick={() => setResetOpen(true)}>
                <RotateCcw /> Reset to printed list…
              </Button>
            </>
          )}
        </div>
      )}
      {st && st.missingPrice > 0 && <Notice tone="red">{st.missingPrice} active products have no price and block approval.</Notice>}

      <h2 className="text-sm font-semibold">Entries needing review ({rows.length})</h2>
      {list.loading && !list.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>Nothing left to review.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <Th>S.No</Th>
              <Th>Printed name</Th>
              <Th>Unit</Th>
              <Th right>Rate</Th>
              <Th>Why it is flagged</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td num>{p.printedNo}</Td>
                <Td>
                  <div className="font-medium">{p.nameEn}</div>
                  <div className="ta text-xs text-muted-foreground">{p.nameTa}</div>
                </Td>
                <Td>{p.unit}</Td>
                <Td num>{p.pricePaise === null ? '—' : formatINR(p.pricePaise)}</Td>
                <Td className="max-w-md text-xs text-muted-foreground">{p.reviewReason}</Td>
                <Td className="whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => onEdit(p)}>
                    <Pencil /> Edit
                  </Button>{' '}
                  <Button size="sm" disabled={busy} onClick={() => void verify([p.id])}>
                    Verified
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {(changed.data?.length ?? 0) > 0 && (
        <>
          <h2 className="mt-2 text-sm font-semibold">Rates changed from the printed list ({changed.data!.length})</h2>
          <TableWrap>
            <thead>
              <tr>
                <Th>S.No</Th>
                <Th>Product</Th>
                <Th right>Printed rate</Th>
                <Th right>Current rate</Th>
              </tr>
            </thead>
            <tbody>
              {changed.data!.map((p) => (
                <tr key={p.id}>
                  <Td num>{p.printedNo}</Td>
                  <Td>{p.nameEn}</Td>
                  <Td num>{formatINR(p.printedPricePaise ?? 0)}</Td>
                  <Td num>
                    <Badge tone="gold">{p.pricePaise === null ? 'No price' : formatINR(p.pricePaise)}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}

      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} title="Mark every flagged entry as verified?" description="Only do this after comparing each flagged entry with the printed list. Entries you did not check will no longer be highlighted." confirmLabel="Mark all verified" onConfirm={() => { setConfirmAll(false); void verify(rows.map((r) => r.id)); }} />
      <Dialog open={resetOpen} onOpenChange={setResetOpen} title="Reset catalogue to the printed list" description="Restores printed names, units, rates and flags for all 114 printed entries and withdraws approval." footer={<><Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button><Button variant="destructive" disabled={busy || !pw} onClick={() => void reset()}>Reset catalogue</Button></>}>
        <div className="flex flex-col gap-3">
          <Notice tone="amber">Stock quantities, sales, returns, purchases and the audit log are never changed or deleted by this action. Products you added yourself are kept.</Notice>
          <Field label="Confirm with your password">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
          </Field>
          {resetErr && <Notice tone="red">{resetErr}</Notice>}
        </div>
      </Dialog>
    </div>
  );
}

function Step({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${ok ? 'border-primary/40 bg-secondary' : 'border-border bg-card'}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        {ok && <CircleCheck className="h-4 w-4 text-primary" />}
        {title}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{text}</div>
    </div>
  );
}
