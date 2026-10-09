import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, ErrorNote, Loading, TableWrap, Td, Th } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { CheckRow, Field, Input, Select } from '@/components/ui/form';
import { useAsync } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { bpToPercent, percentToBp } from '@shared/money';
import type { CategoryDTO } from '@/lib/types';

export function CategoriesTab({ onChanged }: { onChanged: () => void }) {
  const { can, settings } = useAuth();
  const toast = useToast();
  const cats = useAsync(() => call<CategoryDTO[]>('categories:list'), []);
  const [edit, setEdit] = useState<CategoryDTO | 'new' | null>(null);
  const [f, setF] = useState({ nameEn: '', nameTa: '', note: '', rule: 'inherit', pct: '', active: true });
  const [err, setErr] = useState<string | null>(null);

  const open = (c: CategoryDTO | 'new') => {
    setErr(null);
    setEdit(c);
    if (c === 'new') setF({ nameEn: '', nameTa: '', note: '', rule: 'inherit', pct: '', active: true });
    else setF({ nameEn: c.nameEn, nameTa: c.nameTa, note: c.note ?? '', rule: c.discountRule, pct: c.discountBp === null ? '' : bpToPercent(c.discountBp), active: c.active });
  };

  const save = async () => {
    const bp = f.pct.trim() === '' ? null : percentToBp(f.pct);
    if (f.pct.trim() !== '' && bp === null) return setErr('Discount must be a percentage from 0 to 100');
    try {
      await call('categories:save', { id: edit === 'new' || !edit ? null : edit.id, data: { nameEn: f.nameEn, nameTa: f.nameTa, note: f.note || null, discountRule: f.rule, discountBp: bp, active: f.active } });
      toast.success('Category saved');
      setEdit(null);
      cats.reload();
      onChanged();
    } catch (e) {
      setErr(errMsg(e));
    }
  };

  if (cats.error) return <ErrorNote error={cats.error} onRetry={cats.reload} />;
  if (!cats.data) return <Loading />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Category rules decide discounts for products that follow the category. Shop default: {bpToPercent(settings?.['discount.default_bp'] ?? 0)}%.</p>
        {can('products.edit') && (
          <Button onClick={() => open('new')}>
            <Plus /> Add category
          </Button>
        )}
      </div>
      <TableWrap>
        <thead>
          <tr>
            <Th>Category</Th>
            <Th>தமிழ்</Th>
            <Th right>Products</Th>
            <Th>Discount rule</Th>
            <Th>Note</Th>
            <Th> </Th>
          </tr>
        </thead>
        <tbody>
          {cats.data.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">
                {c.nameEn} {!c.active && <Badge>inactive</Badge>}
              </Td>
              <Td className="ta">{c.nameTa}</Td>
              <Td num>{c.productCount}</Td>
              <Td>{c.discountRule === 'never' ? <Badge tone="red">No discount</Badge> : c.discountBp !== null ? <Badge tone="gold">{bpToPercent(c.discountBp)}%</Badge> : <Badge tone="green">Shop default</Badge>}</Td>
              <Td className="max-w-sm text-xs text-muted-foreground">{c.note}</Td>
              <Td>
                {can('products.edit') && (
                  <Button size="sm" variant="outline" onClick={() => open(c)}>
                    <Pencil /> Edit
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add category' : 'Edit category'} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!f.nameEn.trim()} onClick={() => void save()}>Save</Button></>}>
        <div className="flex flex-col gap-3">
          <Field label="English name"><Input value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} autoFocus /></Field>
          <Field label="Tamil name"><Input className="ta" value={f.nameTa} onChange={(e) => setF({ ...f, nameTa: e.target.value })} /></Field>
          <Field label="Discount rule for this category">
            <Select value={f.rule} onChange={(e) => setF({ ...f, rule: e.target.value })}>
              <option value="inherit">Eligible (follow shop discount)</option>
              <option value="never">Non-discountable category</option>
            </Select>
          </Field>
          {f.rule !== 'never' && (
            <Field label="Category discount % (optional)" hint="Leave empty to use the shop default">
              <Input value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} inputMode="decimal" />
            </Field>
          )}
          <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
          <CheckRow checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Active" />
          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>
      </Dialog>
    </div>
  );
}
