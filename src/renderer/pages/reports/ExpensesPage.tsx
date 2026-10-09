import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Badge, Empty, ErrorNote, Loading, Notice, PageHeader, Stat, TableWrap, Td, Th } from '@/components/ui/misc';
import { useAsync } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { formatINR, parseRupees } from '@shared/money';
import { fmtDate, startOfMonth, todayIST, MODE_LABELS } from '@/lib/utils';
import type { ExpenseDTO } from '@/lib/types';
import { EXPENSE_CATEGORIES } from '@shared/expenseCategories';

export function ExpensesPage() {
  const toast = useToast();
  const [from, setFrom] = useState(startOfMonth(todayIST()));
  const [to, setTo] = useState(todayIST());
  const list = useAsync(() => call<{ rows: ExpenseDTO[]; totalPaise: number }>('expenses:list', { from, to, includeVoided: true }), [from, to]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: todayIST(), category: EXPENSE_CATEGORIES[0] as string, description: '', amount: '', mode: 'cash' });
  const [err, setErr] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<ExpenseDTO | null>(null);
  const [reason, setReason] = useState('');

  const save = async () => {
    const amt = parseRupees(f.amount);
    if (!amt || amt <= 0) return setErr('Enter a valid amount');
    try {
      await call('expenses:create', { expenseDate: f.date, category: f.category, description: f.description || null, amountPaise: amt, paymentMode: f.mode });
      toast.success('Expense recorded');
      setOpen(false);
      setF({ ...f, description: '', amount: '' });
      list.reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  const doVoid = async () => {
    if (!voiding) return;
    try {
      await call('expenses:void', { id: voiding.id, reason });
      toast.success('Expense voided');
      setVoiding(null);
      setReason('');
      list.reload();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Shop running costs. Expenses are never deleted - a voided entry stays on record with its reason." actions={<Button onClick={() => { setErr(null); setOpen(true); }}><Plus /> Add expense</Button>} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="ml-auto w-56"><Stat label="Total in period (excl. voided)" value={formatINR(list.data?.totalPaise ?? 0)} /></div>
      </div>
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.rows.length === 0 ? <Empty>No expenses in this period.</Empty> : (
        <TableWrap>
          <thead><tr><Th>Date</Th><Th>Category</Th><Th>Description</Th><Th>Paid by</Th><Th right>Amount</Th><Th>By</Th><Th> </Th></tr></thead>
          <tbody>
            {list.data.rows.map((e) => (
              <tr key={e.id} className={e.voided ? 'opacity-50' : ''}>
                <Td className="whitespace-nowrap">{fmtDate(e.expenseDate)}</Td><Td>{e.category}</Td><Td className="max-w-md text-xs">{e.description}{e.voided && <div className="text-destructive">Voided: {e.voidReason}</div>}</Td><Td>{MODE_LABELS[e.paymentMode] ?? e.paymentMode}</Td>
                <Td num className={e.voided ? 'line-through' : ''}>{formatINR(e.amountPaise)}</Td><Td>{e.createdBy}</Td>
                <Td>{e.voided ? <Badge tone="red">void</Badge> : <Button size="sm" variant="ghost" onClick={() => { setVoiding(e); setReason(''); }}>Void</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Dialog open={open} onOpenChange={setOpen} title="Add expense" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void save()}>Save expense</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Amount (₹)"><Input autoFocus inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Paid by"><Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></Select></Field>
          <Field label="Description" className="col-span-2"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          {err && <div className="col-span-2"><Notice tone="red">{err}</Notice></div>}
        </div>
      </Dialog>
      <Dialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)} title="Void expense" description={voiding ? `${voiding.category} · ${formatINR(voiding.amountPaise)}` : undefined} footer={<><Button variant="outline" onClick={() => setVoiding(null)}>Cancel</Button><Button variant="destructive" disabled={reason.trim().length < 3} onClick={() => void doVoid()}>Void expense</Button></>}>
        <Field label="Reason (required)"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
