import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CheckRow, Field, Input, Select } from '@/components/ui/form';
import { Badge, Empty, ErrorNote, Loading, Notice, PageHeader, TableWrap, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from '@/components/ui/misc';
import { ProductSearchBox } from '@/components/ProductSearchBox';
import { useAsync } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { formatINR, parseRupees } from '@shared/money';
import { fmtDate, todayIST } from '@/lib/utils';
import type { ProductDTO, PurchaseSummary, SupplierDTO } from '@/lib/types';

interface Line {
  product: ProductDTO;
  qty: string;
  cost: string;
}

export function PurchasesPage() {
  return (
    <div>
      <PageHeader title="Stock purchases" subtitle="Record goods received from suppliers. Receipts add to stock and (optionally) update each product's purchase cost." />
      <Tabs defaultValue="purchases">
        <TabsList>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>
        <TabsContent value="purchases"><PurchasesTab /></TabsContent>
        <TabsContent value="suppliers"><SuppliersTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function PurchasesTab() {
  const toast = useToast();
  const list = useAsync(() => call<{ rows: PurchaseSummary[] }>('purchases:list', { limit: 200 }), []);
  const suppliers = useAsync(() => call<SupplierDTO[]>('suppliers:list'), []);
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState('');
  const [invNo, setInvNo] = useState('');
  const [date, setDate] = useState(todayIST());
  const [notes, setNotes] = useState('');
  const [updateCost, setUpdateCost] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const det = useAsync(() => (detail ? call<{ purchaseNo: string; lines: { productId: number; nameEn: string; qty: number; unitCostPaise: number | null }[]; totalPaise: number; supplierName: string | null }>('purchases:get', { id: detail }) : Promise.resolve(undefined)), [detail]);

  const reset = () => { setSupplier(''); setInvNo(''); setDate(todayIST()); setNotes(''); setLines([]); setErr(null); setUpdateCost(true); };
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (parseRupees(l.cost) ?? 0), 0);

  const save = async () => {
    setErr(null);
    for (const l of lines) {
      if (!/^\d+$/.test(l.qty) || Number(l.qty) < 1) return setErr(`Enter a whole quantity for ${l.product.nameEn}`);
      if (l.cost.trim() !== '' && parseRupees(l.cost) === null) return setErr(`Invalid cost for ${l.product.nameEn}`);
    }
    setBusy(true);
    try {
      const r = await call<PurchaseSummary>('purchases:create', { supplierId: supplier ? Number(supplier) : null, supplierInvoiceNo: invNo || null, purchaseDate: date, notes: notes || null, updateCost, lines: lines.map((l) => ({ productId: l.product.id, qty: Number(l.qty), unitCostPaise: l.cost.trim() === '' ? null : parseRupees(l.cost) })) });
      toast.success(`Purchase ${r.purchaseNo} saved`);
      setOpen(false);
      reset();
      list.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => { reset(); setOpen(true); }}><Plus /> New purchase</Button></div>
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.rows.length === 0 ? <Empty>No purchases recorded yet.</Empty> : (
        <TableWrap>
          <thead><tr><Th>Purchase</Th><Th>Date</Th><Th>Supplier</Th><Th>Supplier invoice</Th><Th right>Lines</Th><Th right>Total cost</Th><Th>By</Th></tr></thead>
          <tbody>
            {list.data.rows.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setDetail(p.id)}>
                <Td className="font-medium">{p.purchaseNo}</Td><Td>{fmtDate(p.purchaseDate)}</Td><Td>{p.supplierName ?? <span className="text-muted-foreground">—</span>}</Td><Td>{p.supplierInvoiceNo}</Td><Td num>{p.lineCount}</Td><Td num>{formatINR(p.totalPaise)}</Td><Td>{p.createdBy}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Dialog open={open} onOpenChange={setOpen} locked={busy} className="max-w-4xl" title="New stock purchase" description="Stock increases when you save. Leave a cost empty if you do not know it." footer={<><span className="mr-auto text-sm">Total cost: <b className="num inline">{formatINR(total)}</b></span><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button disabled={busy || lines.length === 0} onClick={() => void save()}>Save purchase</Button></>}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Supplier"><Select value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">— none —</option>{suppliers.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Supplier invoice no."><Input value={invNo} onChange={(e) => setInvNo(e.target.value)} /></Field>
            <Field label="Date received"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <ProductSearchBox onSelect={(p) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, qty: '1', cost: p.costPaise !== null ? String(p.costPaise / 100) : '' }]))} />
          {lines.length > 0 && (
            <TableWrap>
              <thead><tr><Th>Product</Th><Th right>Quantity</Th><Th right>Unit cost (₹)</Th><Th right>Line total</Th><Th> </Th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.product.id}>
                    <Td><div className="font-medium">{l.product.nameEn}</div><div className="ta text-xs text-muted-foreground">{l.product.nameTa}</div></Td>
                    <Td right><Input aria-label={`Quantity of ${l.product.nameEn}`} className="ml-auto h-8 w-24" inputMode="numeric" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)))} /></Td>
                    <Td right><Input aria-label={`Unit cost of ${l.product.nameEn}`} className="ml-auto h-8 w-28" inputMode="decimal" value={l.cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} /></Td>
                    <Td num>{formatINR((Number(l.qty) || 0) * (parseRupees(l.cost) ?? 0))}</Td>
                    <Td><button aria-label="Remove line" className="text-muted-foreground hover:text-destructive" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <CheckRow checked={updateCost} onChange={setUpdateCost} label="Update each product's purchase cost to this unit cost" hint="Used for stock valuation and profit. Changes are audited." />
          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      </Dialog>
      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)} title={det.data?.purchaseNo ?? 'Purchase'} description={det.data?.supplierName ?? undefined}>
        {!det.data ? <Loading /> : (
          <TableWrap><thead><tr><Th>Product</Th><Th right>Qty</Th><Th right>Unit cost</Th></tr></thead><tbody>{det.data.lines.map((l) => <tr key={l.productId}><Td>{l.nameEn}</Td><Td num>{l.qty}</Td><Td num>{l.unitCostPaise === null ? <Badge>unknown</Badge> : formatINR(l.unitCostPaise)}</Td></tr>)}</tbody></TableWrap>
        )}
      </Dialog>
    </div>
  );
}

function SuppliersTab() {
  const toast = useToast();
  const list = useAsync(() => call<SupplierDTO[]>('suppliers:list'), []);
  const [edit, setEdit] = useState<SupplierDTO | 'new' | null>(null);
  const [f, setF] = useState({ name: '', phone: '', address: '', notes: '', active: true });
  const [err, setErr] = useState<string | null>(null);
  const open = (s: SupplierDTO | 'new') => { setEdit(s); setErr(null); setF(s === 'new' ? { name: '', phone: '', address: '', notes: '', active: true } : { name: s.name, phone: s.phone ?? '', address: s.address ?? '', notes: s.notes ?? '', active: s.active }); };
  const save = async () => {
    try {
      await call('suppliers:save', { id: edit === 'new' || !edit ? null : edit.id, data: { name: f.name, phone: f.phone || null, address: f.address || null, notes: f.notes || null, active: f.active } });
      toast.success('Supplier saved');
      setEdit(null);
      list.reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => open('new')}><Plus /> Add supplier</Button></div>
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? <Empty>No suppliers yet.</Empty> : (
        <TableWrap><thead><tr><Th>Name</Th><Th>Phone</Th><Th>Address</Th><Th>Notes</Th><Th> </Th></tr></thead><tbody>{list.data.map((s) => <tr key={s.id}><Td className="font-medium">{s.name} {!s.active && <Badge>inactive</Badge>}</Td><Td>{s.phone}</Td><Td className="text-xs">{s.address}</Td><Td className="text-xs">{s.notes}</Td><Td><Button size="sm" variant="outline" onClick={() => open(s)}>Edit</Button></Td></tr>)}</tbody></TableWrap>
      )}
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add supplier' : 'Edit supplier'} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!f.name.trim()} onClick={() => void save()}>Save</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Name"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Address"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <CheckRow checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      </Dialog>
    </div>
  );
}
