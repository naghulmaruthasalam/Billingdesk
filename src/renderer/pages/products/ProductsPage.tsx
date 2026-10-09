import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, Empty, ErrorNote, Loading, PageHeader, TableWrap, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from '@/components/ui/misc';
import { useAsync, useDebounced } from '@/hooks/useApi';
import { call } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, bpToPercent } from '@shared/money';
import type { CategoryDTO, ProductDTO } from '@/lib/types';
import { ProductEditDialog } from './ProductEditDialog';
import { ReviewTab } from './ReviewTab';
import { ImportTab } from './ImportTab';
import { CategoriesTab } from './CategoriesTab';

export function ProductsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'products';
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'review' | 'noprice'>('all');
  const [editing, setEditing] = useState<ProductDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const search = useDebounced(q, 150);
  const cats = useAsync(() => call<CategoryDTO[]>('categories:list'), []);
  const list = useAsync(() => call<{ rows: ProductDTO[]; total: number }>('products:list', { search, categoryId: cat ? Number(cat) : undefined, reviewOnly: filter === 'review' || undefined, limit: 2000 }), [search, cat, filter]);

  const rows = (list.data?.rows ?? []).filter((p) => (filter === 'active' ? p.active : filter === 'inactive' ? !p.active : filter === 'noprice' ? p.pricePaise === null : true));
  const reloadAll = () => {
    setVersion((v) => v + 1);
    list.reload();
    cats.reload();
  };

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Editable product master. Prices are in rupees; stock changes are made in Inventory."
        actions={
          can('products.edit') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add product
            </Button>
          )
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          <TabsTrigger value="products">Product master</TabsTrigger>
          <TabsTrigger value="categories">Categories & discount rules</TabsTrigger>
          <TabsTrigger value="review">Catalogue review</TabsTrigger>
          {can('products.import') && <TabsTrigger value="import">Import / export</TabsTrigger>}
        </TabsList>

        <TabsContent value="products">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search name, தமிழ், SKU, barcode, #serial…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
            </div>
            <Select className="w-52" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category filter">
              <option value="">All categories</option>
              {cats.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameEn}
                </option>
              ))}
            </Select>
            <Select className="w-44" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Status filter">
              <option value="all">All products</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
              <option value="review">Needs review</option>
              <option value="noprice">Missing price</option>
            </Select>
            <span className="ml-auto text-sm text-muted-foreground">{rows.length} shown</span>
          </div>
          {list.error ? (
            <ErrorNote error={list.error} onRetry={list.reload} />
          ) : !list.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <Empty>No products match.</Empty>
          ) : (
            <TableWrap maxHeight="calc(100vh - 230px)">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>SKU</Th>
                  <Th>Product</Th>
                  <Th>Category</Th>
                  <Th>Unit</Th>
                  <Th right>Price</Th>
                  <Th right>Stock</Th>
                  <Th>Discount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => can('products.edit') && setEditing(p)}>
                    <Td num className="text-muted-foreground">{p.printedNo ?? ''}</Td>
                    <Td className="whitespace-nowrap text-xs">{p.sku}</Td>
                    <Td>
                      <div className="font-medium">{p.nameEn}</div>
                      <div className="ta text-xs text-muted-foreground">{p.nameTa}</div>
                    </Td>
                    <Td className="text-xs">{p.categoryName}</Td>
                    <Td>{p.unit}</Td>
                    <Td num>
                      {p.pricePaise === null ? <Badge tone="red">No price</Badge> : formatINR(p.pricePaise)}
                      {p.printedPricePaise !== null && p.pricePaise !== p.printedPricePaise && <div className="text-[11px] text-warning">printed {formatINR(p.printedPricePaise)}</div>}
                    </Td>
                    <Td num className={p.stockQty <= p.minStock ? 'text-warning' : ''}>{p.stockQty}</Td>
                    <Td>{p.effectiveDiscountBp > 0 ? <Badge tone="green">{bpToPercent(p.effectiveDiscountBp)}%</Badge> : <Badge tone="red">None</Badge>} {p.discountRule !== 'inherit' && <Badge tone="gold">{p.discountRule === 'never' ? 'never' : 'always'}</Badge>}</Td>
                    <Td className="whitespace-nowrap">
                      {!p.active && <Badge>inactive</Badge>} {p.reviewStatus === 'needs_review' && <Badge tone="amber" title={p.reviewReason ?? ''}>review</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesTab onChanged={reloadAll} />
        </TabsContent>
        <TabsContent value="review">
          <ReviewTab key={version} onEdit={setEditing} onChanged={reloadAll} />
        </TabsContent>
        {can('products.import') && (
          <TabsContent value="import">
            <ImportTab onImported={reloadAll} />
          </TabsContent>
        )}
      </Tabs>
      <ProductEditDialog product={editing} creating={creating} categories={cats.data ?? []} onClose={() => { setEditing(null); setCreating(false); }} onSaved={reloadAll} />
    </div>
  );
}
