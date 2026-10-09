import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/form';
import { call } from '@/lib/api';
import { useAsync, useDebounced } from '@/hooks/useApi';
import type { ProductDTO } from '@/lib/types';

/** Type-ahead product chooser (English, Tamil, SKU, barcode). Calls onSelect and clears itself. */
export function ProductSearchBox({ onSelect, placeholder = 'Search product to add…', autoFocus }: { onSelect: (p: ProductDTO) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 120);
  const ref = useRef<HTMLDivElement>(null);
  const res = useAsync(() => (dq.trim() ? call<{ rows: ProductDTO[] }>('products:list', { search: dq, activeOnly: true, limit: 8 }).then((r) => r.rows) : Promise.resolve([] as ProductDTO[])), [dq]);
  const rows = res.data ?? [];
  useEffect(() => setHi(0), [dq]);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const pick = (p: ProductDTO) => {
    onSelect(p);
    setQ('');
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative">
      <Input
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        aria-label="Search product"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, rows.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && rows[hi]) {
            e.preventDefault();
            pick(rows[hi]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && rows.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-card shadow-lg" role="listbox">
          {rows.map((p, i) => (
            <button key={p.id} role="option" aria-selected={i === hi} className={`block w-full px-3 py-1.5 text-left text-sm ${i === hi ? 'bg-secondary' : 'hover:bg-muted'}`} onMouseEnter={() => setHi(i)} onClick={() => pick(p)}>
              <span className="font-medium">{p.nameEn}</span> <span className="ta text-xs text-muted-foreground">{p.nameTa}</span>
              <span className="float-right text-xs text-muted-foreground">
                {p.sku} · stock {p.stockQty}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
