import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { call } from '@/lib/api';
import { formatINR } from '@shared/money';
import { cn } from '@/lib/utils';
import { Badge, Kbd, Loading, Empty, ErrorNote } from '@/components/ui/misc';
import { useAsync, useDebounced } from '@/hooks/useApi';
import type { CategoryDTO, ProductDTO } from '@/lib/types';
import { loadShortcuts } from '@/hooks/useShortcuts';

export interface PickerHandle {
  focus: () => void;
}

/** Search-as-you-type catalogue with keyboard navigation. Prefix the search with "3*" to add 3 at once. */
export const ProductPicker = forwardRef<PickerHandle, { onAdd: (p: ProductDTO, qty: number) => void; cartQty: (id: number) => number; refreshKey: number }>(function ProductPicker({ onAdd, cartQty, refreshKey }, ref) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<number | null>(null);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => (input.current?.focus(), input.current?.select()) }));

  const cats = useAsync(() => call<CategoryDTO[]>('categories:list'), []);
  const { qty, text } = parseQty(q);
  const search = useDebounced(text, 120);
  const res = useAsync(() => call<{ rows: ProductDTO[]; total: number }>('products:list', { search, categoryId: cat ?? undefined, sellableOnly: true, limit: 400 }), [search, cat, refreshKey]);
  const rows = res.data?.rows ?? [];

  useEffect(() => setHi(0), [search, cat]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const add = (p: ProductDTO) => {
    onAdd(p, qty);
    setQ('');
    input.current?.focus();
  };

  const onKey = async (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const code = text.trim();
      if (code.length >= 3 && !/\s/.test(code)) {
        // exact barcode / SKU (scanner input ends with Enter)
        try {
          const p = await call<ProductDTO | null>('products:byCode', { code });
          if (p && p.pricePaise !== null) return add(p);
        } catch {
          /* fall through to the highlighted result */
        }
      }
      if (rows[hi]) add(rows[hi]);
    } else if (e.key === 'Escape') {
      setQ('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={input}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          placeholder="Search by name (English / தமிழ்), SKU or scan barcode…   e.g. 3*hydrogen"
          aria-label="Search products"
          className="h-11 w-full rounded-md border border-input bg-card pl-9 pr-16 text-base focus-visible:border-ring"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2">
          <Kbd>{loadShortcuts().focusSearch}</Kbd>
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Categories">
        <Chip active={cat === null} onClick={() => setCat(null)}>
          All
        </Chip>
        {cats.data?.filter((c) => c.active && c.productCount > 0).map((c) => (
          <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)}>
            {c.nameEn}
          </Chip>
        ))}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-card" role="listbox" aria-label="Products">
        {res.error ? (
          <div className="p-3">
            <ErrorNote error={res.error} onRetry={res.reload} />
          </div>
        ) : res.loading && !res.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty>No products match “{text}”.</Empty>
        ) : (
          rows.map((p, i) => {
            const inCart = cartQty(p.id);
            const available = p.stockQty - inCart;
            return (
              <button
                key={p.id}
                data-idx={i}
                role="option"
                aria-selected={i === hi}
                onClick={() => add(p)}
                onMouseMove={() => setHi(i)}
                className={cn('grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-border/70 px-3 py-2 text-left', i === hi ? 'bg-secondary' : 'hover:bg-muted/60')}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.nameEn}</span>
                    {p.effectiveDiscountBp > 0 ? <Badge tone="green">{p.effectiveDiscountBp / 100}% off</Badge> : <Badge tone="neutral">No discount</Badge>}
                  </div>
                  <div className="ta truncate text-xs text-muted-foreground">
                    {p.nameTa || '—'} · {p.sku} · {p.categoryName}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={cn('num text-xs', available <= 0 ? 'text-destructive' : available <= p.minStock ? 'text-warning' : 'text-muted-foreground')}>{available <= 0 ? 'Out of stock' : `${available} in stock`}</span>
                  <div className="text-right">
                    <div className="num font-semibold">{formatINR(p.pricePaise ?? 0)}</div>
                    <div className="text-[11px] text-muted-foreground">per {p.unit}</div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
});

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick} className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted')}>
      {children}
    </button>
  );
}

function parseQty(raw: string): { qty: number; text: string } {
  const m = /^\s*(\d{1,4})\s*[*xX]\s*(.*)$/.exec(raw);
  if (m && Number(m[1]) > 0) return { qty: Number(m[1]), text: m[2] };
  return { qty: 1, text: raw };
}
