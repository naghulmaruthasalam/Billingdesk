import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckRow, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Notice } from '@/components/ui/misc';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { formatINR, paiseToDecimal, parseRupees } from '@shared/money';
import type { CategoryDTO, ProductDTO } from '@/lib/types';

interface Form {
  sku: string;
  barcode: string;
  nameEn: string;
  nameTa: string;
  categoryId: number;
  unit: string;
  price: string;
  cost: string;
  minStock: string;
  discountRule: 'inherit' | 'eligible' | 'never';
  active: boolean;
  notes: string;
  openingStock: string;
}

const empty = (categoryId: number): Form => ({ sku: '', barcode: '', nameEn: '', nameTa: '', categoryId, unit: 'Box', price: '', cost: '', minStock: '0', discountRule: 'inherit', active: true, notes: '', openingStock: '' });

export function ProductEditDialog({ product, creating, categories, onClose, onSaved }: { product: ProductDTO | null; creating: boolean; categories: CategoryDTO[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { settings } = useAuth();
  const open = creating || product !== null;
  const [f, setF] = useState<Form>(empty(categories[0]?.id ?? 0));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (product) {
      setF({
        sku: product.sku,
        barcode: product.barcode ?? '',
        nameEn: product.nameEn,
        nameTa: product.nameTa,
        categoryId: product.categoryId,
        unit: product.unit,
        price: product.pricePaise === null ? '' : paiseToDecimal(product.pricePaise),
        cost: product.costPaise === null ? '' : paiseToDecimal(product.costPaise),
        minStock: String(product.minStock),
        discountRule: product.discountRule,
        active: product.active,
        notes: product.notes ?? '',
        openingStock: '',
      });
    } else setF(empty(categories[0]?.id ?? 0));
  }, [open, product, categories]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setErr(null);
    const price = f.price.trim() === '' ? null : parseRupees(f.price);
    const cost = f.cost.trim() === '' ? null : parseRupees(f.cost);
    if (f.price.trim() !== '' && price === null) return setErr('Price is not a valid amount');
    if (f.cost.trim() !== '' && cost === null) return setErr('Cost is not a valid amount');
    if (!/^\d+$/.test(f.minStock || '0')) return setErr('Minimum stock must be a whole number');
    const data = {
      sku: f.sku.trim() || undefined,
      barcode: f.barcode.trim() || null,
      nameEn: f.nameEn,
      nameTa: f.nameTa,
      categoryId: f.categoryId,
      unit: f.unit,
      pricePaise: price,
      costPaise: cost,
      minStock: Number(f.minStock || 0),
      discountRule: f.discountRule,
      active: f.active,
      notes: f.notes.trim() || null,
    };
    setBusy(true);
    try {
      if (product) await call('products:update', { id: product.id, data });
      else await call('products:create', { ...data, openingStock: f.openingStock.trim() ? Number(f.openingStock) : undefined });
      toast.success(product ? 'Product saved' : 'Product added');
      onSaved();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const cat = categories.find((c) => c.id === f.categoryId);
  const policy = f.discountRule === 'never' ? 'Never discounted' : f.discountRule === 'eligible' ? 'Always discount-eligible' : cat?.discountRule === 'never' ? 'Not discounted (category rule)' : `Shop default ${(cat?.discountBp ?? settings?.['discount.default_bp'] ?? 0) / 100}%`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={product ? 'Edit product' : 'Add product'}
      description={product?.printedNo ? `Printed S.No ${product.printedNo} · printed rate ${formatINR(product.printedPricePaise ?? 0)}` : undefined}
      className="max-w-2xl"
      locked={busy}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !f.nameEn.trim()}>
            {busy ? 'Saving…' : 'Save product'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {product?.reviewStatus === 'needs_review' && (
          <Notice className="col-span-2">
            <b>Needs review:</b> {product.reviewReason}
          </Notice>
        )}
        <Field label="English name" className="col-span-2">
          <Input value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} autoFocus />
        </Field>
        <Field label="Tamil name (தமிழ்)" className="col-span-2">
          <Input className="ta" value={f.nameTa} onChange={(e) => set('nameTa', e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={f.categoryId} onChange={(e) => set('categoryId', Number(e.target.value))}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit / package" hint="e.g. Box, Pkt, Pc, Kg">
          <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} list="unit-options" />
          <datalist id="unit-options">
            {['Box', 'Pkt', 'Pc', 'Kg', 'Set'].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label="Selling price (₹)" hint={product?.printedPricePaise !== null && product ? `Printed rate: ${formatINR(product.printedPricePaise ?? 0)}` : 'Leave empty if unknown - the product then cannot be sold'}>
          <Input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} />
        </Field>
        <Field label="Purchase cost (₹, optional)" hint="Only enter a verified cost. Profit is calculated only where cost exists.">
          <Input inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} />
        </Field>
        <Field label="SKU / product code" hint={product ? undefined : 'Leave empty to assign automatically'}>
          <Input value={f.sku} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Barcode (optional)">
          <Input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} />
        </Field>
        <Field label="Minimum stock alert">
          <Input inputMode="numeric" value={f.minStock} onChange={(e) => set('minStock', e.target.value)} />
        </Field>
        {!product && (
          <Field label="Opening stock (optional)" hint="Only enter a counted quantity">
            <Input inputMode="numeric" value={f.openingStock} onChange={(e) => set('openingStock', e.target.value)} />
          </Field>
        )}
        <Field label="Discount rule" className="col-span-2" hint={`Currently: ${policy}`}>
          <Select value={f.discountRule} onChange={(e) => set('discountRule', e.target.value as Form['discountRule'])}>
            <option value="inherit">Follow category / shop rule</option>
            <option value="eligible">Always eligible for discount</option>
            <option value="never">Never discounted (non-discountable)</option>
          </Select>
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <div className="col-span-2">
          <CheckRow checked={f.active} onChange={(v) => set('active', v)} label="Active (can be sold)" />
        </div>
        {err && (
          <div className="col-span-2">
            <Notice tone="red">{err}</Notice>
          </div>
        )}
      </div>
    </Dialog>
  );
}
