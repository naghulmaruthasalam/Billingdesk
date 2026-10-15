import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select } from '@/components/ui/form';
import { ErrorNote, Loading, Notice, TableWrap, Td, Th } from '@/components/ui/misc';
import { LabelPrintPanel } from '@/components/LabelPrintPanel';
import { useAsync, useDebounced } from '@/hooks/useApi';
import { call } from '@/lib/api';
import type { CategoryDTO, ProductDTO } from '@/lib/types';

/** Choose products and copies, then print barcode labels. Every product already has a unique EAN-13 barcode. */
export function LabelsTab() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [copies, setCopies] = useState<Record<number, number>>({});
  const search = useDebounced(q, 150);
  const cats = useAsync(() => call<CategoryDTO[]>('categories:list'), []);
  const list = useAsync(() => call<{ rows: ProductDTO[] }>('products:list', { search, categoryId: cat ? Number(cat) : undefined, activeOnly: true, limit: 2000 }), [search, cat]);
  const rows = list.data?.rows ?? [];
  const items = useMemo(() => Object.entries(copies).filter(([, n]) => n > 0).map(([id, n]) => ({ productId: Number(id), copies: n })), [copies]);
  const total = items.reduce((s, i) => s + i.copies, 0);

  const setMany = (ps: ProductDTO[], f: (p: ProductDTO) => number) => setCopies((c) => ({ ...c, ...Object.fromEntries(ps.map((p) => [p.id, f(p)])) }));

  return (
    <div className="flex flex-col gap-3">
      <Notice tone="green">Every product has its own barcode (EAN-13), created automatically and never changed, so printed labels stay valid. Stick the label on the carton or box: scanning it at New Bill adds the product at once.</Notice>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,460px)_1fr]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products for labels" /></div>
            <Select className="w-40" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
            </Select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setMany(rows, () => 1)}>1 each for {rows.length} shown</Button>
            <Button size="sm" variant="outline" onClick={() => setMany(rows.filter((p) => p.stockQty > 0), (p) => p.stockQty)}>Copies = stock</Button>
            <Button size="sm" variant="ghost" onClick={() => setCopies({})}>Clear ({total})</Button>
          </div>
          {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
            <TableWrap maxHeight="52vh">
              <thead><tr><Th> </Th><Th>Product</Th><Th>Barcode</Th><Th right>Copies</Th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <Td><Checkbox aria-label={`Select ${p.nameEn}`} checked={(copies[p.id] ?? 0) > 0} onCheckedChange={(v) => setCopies((c) => ({ ...c, [p.id]: v === true ? Math.max(1, c[p.id] ?? 1) : 0 }))} /></Td>
                    <Td><div className="font-medium">{p.nameEn}</div><div className="ta text-xs text-muted-foreground">{p.nameTa}</div></Td>
                    <Td className="num !text-left font-mono text-xs">{p.barcode}</Td>
                    <Td right><Input aria-label={`Copies of ${p.nameEn}`} className="ml-auto h-8 w-16" inputMode="numeric" value={copies[p.id] ?? ''} placeholder="0" onChange={(e) => setCopies((c) => ({ ...c, [p.id]: Math.min(500, Number(e.target.value.replace(/\D/g, '')) || 0) }))} /></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
        <LabelPrintPanel items={items} />
      </div>
    </div>
  );
}
