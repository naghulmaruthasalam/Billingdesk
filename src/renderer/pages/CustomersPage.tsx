import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CheckRow, Field, Input } from '@/components/ui/form';
import { Badge, Empty, ErrorNote, Loading, Notice, PageHeader, TableWrap, Td, Th } from '@/components/ui/misc';
import { useAsync, useDebounced } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { formatINR } from '@shared/money';
import { fmtDate } from '@/lib/utils';
import type { CustomerDTO } from '@/lib/types';

export function CustomersPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const search = useDebounced(q, 200);
  const list = useAsync(() => call<{ rows: CustomerDTO[]; total: number }>('customers:list', { search, limit: 500 }), [search]);
  const [edit, setEdit] = useState<CustomerDTO | 'new' | null>(null);
  const [f, setF] = useState({ name: '', phone: '', notes: '', active: true });
  const [err, setErr] = useState<string | null>(null);
  const open = (c: CustomerDTO | 'new') => { setEdit(c); setErr(null); setF(c === 'new' ? { name: '', phone: '', notes: '', active: true } : { name: c.name, phone: c.phone ?? '', notes: c.notes ?? '', active: c.active }); };
  const save = async () => {
    try {
      await call('customers:save', { id: edit === 'new' || !edit ? null : edit.id, data: { name: f.name, phone: f.phone || null, notes: f.notes || null, active: f.active } });
      toast.success('Customer saved');
      setEdit(null);
      list.reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div>
      <PageHeader title="Customers" subtitle="Optional. Customers are created automatically when a bill includes a name or phone number." actions={<Button onClick={() => open('new')}><Plus /> Add customer</Button>} />
      <div className="relative mb-3 w-80"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search name or phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" /></div>
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.rows.length === 0 ? <Empty>No customers found.</Empty> : (
        <TableWrap maxHeight="calc(100vh - 230px)">
          <thead><tr><Th>Name</Th><Th>Phone</Th><Th right>Bills</Th><Th right>Total billed</Th><Th>Last purchase</Th><Th>Notes</Th><Th> </Th></tr></thead>
          <tbody>
            {list.data.rows.map((c) => (
              <tr key={c.id}><Td className="font-medium">{c.name} {!c.active && <Badge>inactive</Badge>}</Td><Td>{c.phone}</Td><Td num>{c.billCount}</Td><Td num>{formatINR(c.totalPaise)}</Td><Td>{c.lastPurchase ? fmtDate(c.lastPurchase) : '—'}</Td><Td className="text-xs">{c.notes}</Td><Td><Button size="sm" variant="outline" onClick={() => open(c)}>Edit</Button></Td></tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add customer' : 'Edit customer'} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!f.name.trim()} onClick={() => void save()}>Save</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="Name"><Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <CheckRow checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      </Dialog>
    </div>
  );
}
