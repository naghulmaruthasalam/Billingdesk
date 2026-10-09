import { useMemo, useState } from 'react';
import { Download, FileUp, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CheckRow, Field, Input, Select } from '@/components/ui/form';
import { Badge, Empty, ErrorNote, Loading, Notice, PageHeader, TableWrap, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from '@/components/ui/misc';
import { useAsync, useDebounced } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { openTextFile, saveFileResult } from '@/lib/files';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { formatINR } from '@shared/money';
import { fmtDateTime, todayIST } from '@/lib/utils';
import type { FileResult, MovementRow, ProductDTO, ReconcileRow, StockCsvPreviewRow, ValuationRow } from '@/lib/types';

const TYPE_LABEL: Record<string, string> = { opening: 'Opening balance', purchase: 'Purchase', sale: 'Sale', sale_cancel: 'Bill cancelled', return_restock: 'Return (restocked)', return_damaged: 'Return (damaged)', adjustment: 'Adjustment', damage: 'Damaged', expiry: 'Expired', count_correction: 'Stock count' };

export function InventoryPage() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Every change to stock is recorded with a reason, time and user. Opening quantities are never invented - enter counted stock." />
      <Tabs defaultValue="levels">
        <TabsList>
          <TabsTrigger value="levels">Stock levels</TabsTrigger>
          {can('inventory.adjust') && <TabsTrigger value="opening">Opening stock</TabsTrigger>}
          <TabsTrigger value="movements">Movement history</TabsTrigger>
          <TabsTrigger value="reconcile">Daily reconciliation</TabsTrigger>
          {can('inventory.adjust') && <TabsTrigger value="valuation">Valuation</TabsTrigger>}
        </TabsList>
        <TabsContent value="levels"><LevelsTab /></TabsContent>
        {can('inventory.adjust') && <TabsContent value="opening"><OpeningTab /></TabsContent>}
        <TabsContent value="movements"><MovementsTab /></TabsContent>
        <TabsContent value="reconcile"><ReconcileTab /></TabsContent>
        {can('inventory.adjust') && <TabsContent value="valuation"><ValuationTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

function LevelsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const search = useDebounced(q, 150);
  const list = useAsync(() => call<{ rows: ProductDTO[] }>('products:list', { search, lowStockOnly: low || undefined, activeOnly: true, limit: 2000 }), [search, low]);
  const [adj, setAdj] = useState<ProductDTO | null>(null);
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [type, setType] = useState<'adjustment' | 'damage' | 'expiry'>('adjustment');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!adj) return;
    const n = Number(qty);
    const value = type !== 'adjustment' ? -Math.abs(n) : n;
    try {
      await call('inventory:adjust', { productId: adj.id, mode: type !== 'adjustment' ? 'delta' : mode, qty: value, type, reason });
      toast.success('Stock updated');
      setAdj(null);
      list.reload();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  const openAdj = (p: ProductDTO) => {
    setAdj(p);
    setMode('delta');
    setType('adjustment');
    setQty('');
    setReason('');
    setErr(null);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <div className="relative w-80"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stock" /></div>
        <CheckRow checked={low} onChange={setLow} label="Low / zero stock only" />
      </div>
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.rows.length === 0 ? <Empty>No products.</Empty> : (
        <TableWrap maxHeight="calc(100vh - 260px)">
          <thead><tr><Th>SKU</Th><Th>Product</Th><Th>Unit</Th><Th right>In stock</Th><Th right>Minimum</Th><Th>Status</Th><Th> </Th></tr></thead>
          <tbody>
            {list.data.rows.map((p) => (
              <tr key={p.id}>
                <Td className="text-xs">{p.sku}</Td>
                <Td><div className="font-medium">{p.nameEn}</div><div className="ta text-xs text-muted-foreground">{p.nameTa}</div></Td>
                <Td>{p.unit}</Td>
                <Td num className="font-semibold">{p.stockQty}</Td>
                <Td num>{p.minStock}</Td>
                <Td>{p.stockQty < 0 ? <Badge tone="red">negative</Badge> : p.stockQty === 0 ? <Badge tone="red">out</Badge> : p.stockQty <= p.minStock ? <Badge tone="amber">low</Badge> : <Badge tone="green">ok</Badge>}</Td>
                <Td>{can('inventory.adjust') && <Button size="sm" variant="outline" onClick={() => openAdj(p)}>Adjust</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Dialog open={adj !== null} onOpenChange={(o) => !o && setAdj(null)} title="Adjust stock" description={adj ? `${adj.nameEn} · currently ${adj.stockQty} ${adj.unit}` : undefined} footer={<><Button variant="outline" onClick={() => setAdj(null)}>Cancel</Button><Button onClick={() => void save()} disabled={!qty || reason.trim().length < 3}>Save adjustment</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="adjustment">Correction (add / remove / set count)</option>
              <option value="damage">Damaged stock written off</option>
              <option value="expiry">Expired stock written off</option>
            </Select>
          </Field>
          {type === 'adjustment' && (
            <Field label="Method">
              <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="delta">Add or remove a quantity (use − to remove)</option>
                <option value="set">Set to the counted quantity</option>
              </Select>
            </Field>
          )}
          <Field label={type !== 'adjustment' ? 'Quantity lost' : mode === 'set' ? 'Counted quantity' : 'Quantity change (+/−)'}>
            <Input autoFocus inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d-]/g, ''))} />
          </Field>
          <Field label="Reason (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recount, water damage" /></Field>
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      </Dialog>
    </div>
  );
}

function OpeningTab() {
  const toast = useToast();
  const list = useAsync(() => call<{ rows: ProductDTO[] }>('products:list', { activeOnly: true, limit: 2000 }), []);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [q, setQ] = useState('');
  const [csv, setCsv] = useState<StockCsvPreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rows = useMemo(() => (list.data?.rows ?? []).filter((p) => !q || `${p.nameEn} ${p.nameTa} ${p.sku}`.toLowerCase().includes(q.toLowerCase())), [list.data, q]);
  const pending = Object.entries(vals).filter(([, v]) => v !== '');

  const save = async (entries: { productId: number; qty: number }[]) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ updated: number }>('inventory:setOpening', { rows: entries });
      toast.success(`${r.updated} opening balances saved`);
      setVals({});
      setCsv(null);
      list.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseCsv = async () => {
    try {
      const f = await openTextFile(['csv'], 'CSV files');
      if (f) setCsv(await call<StockCsvPreviewRow[]>('inventory:previewStockCsv', { text: f.text }));
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Notice>Enter the quantity you have physically counted for each product. Leave a row empty to leave it untouched. Each entry is recorded as an “Opening balance” movement.</Notice>
      {err && <Notice tone="red">{err}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-72" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter products" />
        <Button variant="outline" onClick={() => void chooseCsv()}><FileUp /> Import counts from CSV (sku, qty)…</Button>
        <Button className="ml-auto" disabled={busy || pending.length === 0} onClick={() => void save(pending.map(([id, v]) => ({ productId: Number(id), qty: Number(v) })))}>Save {pending.length} opening balances</Button>
      </div>
      {csv && (
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between text-sm"><span>CSV preview: {csv.filter((r) => r.status === 'ok').length} valid, {csv.filter((r) => r.status === 'error').length} with errors (skipped)</span><span className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setCsv(null)}>Discard</Button><Button size="sm" disabled={busy || !csv.some((r) => r.status === 'ok')} onClick={() => void save(csv.filter((r) => r.status === 'ok').map((r) => ({ productId: r.productId!, qty: r.newQty! })))}>Apply valid rows</Button></span></div>
          <TableWrap maxHeight="30vh"><thead><tr><Th>Line</Th><Th>SKU</Th><Th>Product</Th><Th right>Current</Th><Th right>New</Th><Th>Issues</Th></tr></thead><tbody>{csv.map((r) => <tr key={r.line}><Td num>{r.line}</Td><Td>{r.sku}</Td><Td>{r.nameEn}</Td><Td num>{r.currentQty ?? ''}</Td><Td num>{r.newQty ?? ''}</Td><Td className="text-xs text-destructive">{r.issues.join('; ')}</Td></tr>)}</tbody></TableWrap>
        </div>
      )}
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
        <TableWrap maxHeight="calc(100vh - 340px)">
          <thead><tr><Th>SKU</Th><Th>Product</Th><Th>Unit</Th><Th right>Current stock</Th><Th right>Counted quantity</Th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td className="text-xs">{p.sku}</Td>
                <Td><div className="font-medium">{p.nameEn}</div><div className="ta text-xs text-muted-foreground">{p.nameTa}</div></Td>
                <Td>{p.unit}</Td>
                <Td num>{p.stockQty}</Td>
                <Td right><Input aria-label={`Counted quantity for ${p.nameEn}`} className="ml-auto h-8 w-28" inputMode="numeric" value={vals[p.id] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [p.id]: e.target.value.replace(/\D/g, '') }))} /></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

function MovementsTab() {
  const [from, setFrom] = useState(todayIST().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIST());
  const [type, setType] = useState('');
  const list = useAsync(() => call<{ rows: MovementRow[]; total: number }>('inventory:movements', { from, to, type: type || undefined, limit: 500 }), [from, to, type]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.rows.length === 0 ? <Empty>No stock movements in this period.</Empty> : (
        <TableWrap maxHeight="calc(100vh - 280px)">
          <thead><tr><Th>When</Th><Th>Product</Th><Th>Type</Th><Th right>Change</Th><Th right>Balance</Th><Th>Reason / reference</Th><Th>By</Th></tr></thead>
          <tbody>
            {list.data.rows.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</Td>
                <Td><div className="font-medium">{m.nameEn}</div><div className="text-xs text-muted-foreground">{m.sku}</div></Td>
                <Td>{TYPE_LABEL[m.type] ?? m.type}</Td>
                <Td num className={m.qtyDelta < 0 ? 'text-destructive' : m.qtyDelta > 0 ? 'text-primary' : ''}>{m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}</Td>
                <Td num>{m.qtyAfter}</Td>
                <Td className="max-w-md text-xs">{m.reason}</Td>
                <Td>{m.user}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {list.data && list.data.total > list.data.rows.length && <p className="mt-2 text-xs text-muted-foreground">Showing the latest {list.data.rows.length} of {list.data.total}. Narrow the dates or use Reports → Stock movements to export everything.</p>}
    </div>
  );
}

function ReconcileTab() {
  const { can } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayIST());
  const [onlyActive, setOnlyActive] = useState(true);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const list = useAsync(() => call<ReconcileRow[]>('inventory:reconcile', { date }), [date]);
  const rows = (list.data ?? []).filter((r) => !onlyActive || r.openingQty || r.purchased || r.sold || r.returned || r.adjusted || r.systemClosing);
  const pending = Object.entries(counts).filter(([, v]) => v !== '');

  const apply = async () => {
    try {
      const r = await call<{ corrected: number }>('inventory:count', { date, counts: pending.map(([id, v]) => ({ productId: Number(id), countedQty: Number(v) })) });
      toast.success(`${r.corrected} stock counts corrected`);
      setCounts({});
      list.reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Business date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <CheckRow checked={onlyActive} onChange={setOnlyActive} label="Hide products with no stock activity" />
        {can('inventory.adjust') && <Button className="ml-auto" disabled={pending.length === 0} onClick={() => void apply()}>Apply {pending.length} physical counts</Button>}
      </div>
      <Notice>Opening + purchases − sales + returns ± adjustments = closing. “Variance” shows any mismatch between the ledger and the stock on record. Type a physical count to correct stock; each correction is logged.</Notice>
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : rows.length === 0 ? <Empty>No stock activity on this date.</Empty> : (
        <TableWrap maxHeight="calc(100vh - 330px)">
          <thead><tr><Th>Product</Th><Th right>Opening</Th><Th right>Purchased</Th><Th right>Sold</Th><Th right>Returns</Th><Th right>Adjusted</Th><Th right>Closing</Th><Th right>Variance</Th>{can('inventory.adjust') && <Th right>Physical count</Th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId}>
                <Td><div className="font-medium">{r.nameEn}</div><div className="text-xs text-muted-foreground">{r.sku}</div></Td>
                <Td num>{r.openingQty}</Td><Td num>{r.purchased || ''}</Td><Td num>{r.sold || ''}</Td><Td num>{r.returned || ''}</Td><Td num>{r.adjusted || ''}</Td>
                <Td num className="font-semibold">{r.expectedClosing}</Td>
                <Td num className={r.variance ? 'text-destructive' : ''}>{r.variance || '—'}</Td>
                {can('inventory.adjust') && <Td right><Input aria-label={`Physical count for ${r.nameEn}`} className="ml-auto h-8 w-24" inputMode="numeric" value={counts[r.productId] ?? ''} onChange={(e) => setCounts((s) => ({ ...s, [r.productId]: e.target.value.replace(/\D/g, '') }))} /></Td>}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}

function ValuationTab() {
  const toast = useToast();
  const v = useAsync(() => call<{ rows: ValuationRow[]; totalPaise: number; productsWithoutCost: number }>('inventory:valuation'), []);
  const exp = async () => {
    try {
      const f = await call<FileResult>('reports:export', { name: 'stock_valuation', from: todayIST(), to: todayIST(), format: 'csv' });
      const s = await saveFileResult(f);
      if (s.saved) toast.success(`Saved ${s.path}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  if (v.error) return <ErrorNote error={v.error} onRetry={v.reload} />;
  if (!v.data) return <Loading />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Stock value at purchase cost</div>
          <div className="num !text-left text-2xl font-semibold">{formatINR(v.data.totalPaise)}</div>
        </div>
        <Button variant="outline" onClick={() => void exp()}><Download /> Export CSV</Button>
      </div>
      {v.data.productsWithoutCost > 0 && <Notice>{v.data.productsWithoutCost} products in stock have no purchase cost recorded and are not valued. Costs are only set from purchases or by editing a product - they are never guessed.</Notice>}
      <TableWrap maxHeight="calc(100vh - 340px)">
        <thead><tr><Th>Product</Th><Th>Category</Th><Th right>In stock</Th><Th right>Unit cost</Th><Th right>Value</Th></tr></thead>
        <tbody>
          {v.data.rows.filter((r) => r.stockQty !== 0 || r.costPaise !== null).map((r) => (
            <tr key={r.productId}><Td>{r.nameEn}</Td><Td className="text-xs">{r.categoryName}</Td><Td num>{r.stockQty}</Td><Td num>{r.costPaise === null ? '—' : formatINR(r.costPaise)}</Td><Td num>{r.valuePaise === null ? <span className="text-muted-foreground">no cost</span> : formatINR(r.valuePaise)}</Td></tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
