import { useEffect, useMemo, useState } from 'react';
import { FileDown, Printer, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CheckRow, Field, Input, Select } from '@/components/ui/form';
import { Notice, Spinner } from '@/components/ui/misc';
import { call, errMsg } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/hooks/useApi';
import { DEFAULT_LABEL_LAYOUT, type LabelLayout } from '@shared/labelHtml';

export interface LabelRun {
  productId: number;
  copies: number;
}

interface Preview {
  html: string;
  labels: number;
  pages: number;
  moduleMm: number;
  skipped: { sku: string; nameEn: string; reason: string }[];
}

const PRESETS: { id: string; label: string; layout: Partial<LabelLayout> }[] = [
  { id: 't50x30', label: 'Roll label 50 × 30 mm', layout: { kind: 'thermal', widthMm: 50, heightMm: 30 } },
  { id: 't40x30', label: 'Roll label 40 × 30 mm', layout: { kind: 'thermal', widthMm: 40, heightMm: 30 } },
  { id: 't60x40', label: 'Roll label 60 × 40 mm', layout: { kind: 'thermal', widthMm: 60, heightMm: 40 } },
  { id: 'a24', label: 'A4 sticker sheet 3 × 8 (24 labels)', layout: { kind: 'a4', cols: 3, rows: 8, marginTopMm: 10, marginLeftMm: 7, gapMm: 0 } },
  { id: 'a40', label: 'A4 sticker sheet 4 × 10 (40 labels)', layout: { kind: 'a4', cols: 4, rows: 10, marginTopMm: 10, marginLeftMm: 5, gapMm: 0 } },
  { id: 'a21', label: 'A4 sticker sheet 3 × 7 (21 labels)', layout: { kind: 'a4', cols: 3, rows: 7, marginTopMm: 15, marginLeftMm: 7, gapMm: 0 } },
];

const num = (v: string, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Label layout controls, live preview, and Print / Save-as-PDF for a set of products. Used by the Labels tab and the product dialog. */
export function LabelPrintPanel({ items, previewHeight = '46vh' }: { items: LabelRun[]; previewHeight?: string }) {
  const { settings, reloadSettings, can } = useAuth();
  const toast = useToast();
  const [layout, setLayout] = useState<LabelLayout>(DEFAULT_LABEL_LAYOUT);
  const [startAt, setStartAt] = useState(0);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) setLayout(settings['labels.layout']);
  }, [settings]);

  const key = useDebounced(JSON.stringify({ items, layout, startAt }), 250);
  useEffect(() => {
    if (items.length === 0) {
      setPrev(null);
      return;
    }
    let alive = true;
    const req = JSON.parse(key) as { items: LabelRun[]; layout: LabelLayout; startAt: number };
    call<Preview>('labels:html', { items: req.items, layout: req.layout, startAt: req.layout.kind === 'a4' ? req.startAt : 0 })
      .then((r) => {
        if (alive) {
          setPrev(r);
          setError(null);
        }
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [key, items.length]);

  const preset = useMemo(() => PRESETS.find((p) => Object.entries(p.layout).every(([k, v]) => layout[k as keyof LabelLayout] === v))?.id ?? 'custom', [layout]);
  const set = <K extends keyof LabelLayout>(k: K, v: LabelLayout[K]) => setLayout((l) => ({ ...l, [k]: v }));

  const run = async (mode: 'print' | 'pdf') => {
    setBusy(true);
    try {
      const r = await call<{ printed?: boolean; saved?: boolean; path?: string; printer?: string | null; note?: string | null }>('print:labels', { items, layout, startAt: layout.kind === 'a4' ? startAt : 0, mode });
      if (r.note) toast.info(r.note);
      if (r.printed) toast.success(r.printer ? `Labels sent to ${r.printer}` : 'Labels sent to the printer');
      if (r.saved) toast.success(`Saved PDF: ${r.path}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDefault = async () => {
    try {
      await call('settings:update', { patch: { 'labels.layout': layout } });
      await reloadSettings();
      toast.success('Saved as the shop default label layout');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const thin = prev !== null && prev.moduleMm < 0.25;
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-3">
        <Field label="Label type">
          <Select value={preset} onChange={(e) => { const p = PRESETS.find((x) => x.id === e.target.value); if (p) setLayout((l) => ({ ...l, ...p.layout })); }} aria-label="Label type">
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            {preset === 'custom' && <option value="custom">Custom size</option>}
          </Select>
        </Field>
        {layout.kind === 'thermal' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Width (mm)"><Input inputMode="decimal" value={layout.widthMm} onChange={(e) => set('widthMm', num(e.target.value, layout.widthMm))} /></Field>
            <Field label="Height (mm)"><Input inputMode="decimal" value={layout.heightMm} onChange={(e) => set('heightMm', num(e.target.value, layout.heightMm))} /></Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Columns"><Input inputMode="numeric" value={layout.cols} onChange={(e) => set('cols', Math.max(1, Math.round(num(e.target.value, layout.cols))))} /></Field>
            <Field label="Rows"><Input inputMode="numeric" value={layout.rows} onChange={(e) => set('rows', Math.max(1, Math.round(num(e.target.value, layout.rows))))} /></Field>
            <Field label="Top margin (mm)"><Input inputMode="decimal" value={layout.marginTopMm} onChange={(e) => set('marginTopMm', num(e.target.value, layout.marginTopMm))} /></Field>
            <Field label="Left margin (mm)"><Input inputMode="decimal" value={layout.marginLeftMm} onChange={(e) => set('marginLeftMm', num(e.target.value, layout.marginLeftMm))} /></Field>
            <Field label="Gap (mm)"><Input inputMode="decimal" value={layout.gapMm} onChange={(e) => set('gapMm', num(e.target.value, layout.gapMm))} /></Field>
            <Field label="Start at label no." hint="Reuse a part-used sheet"><Input inputMode="numeric" value={startAt + 1} onChange={(e) => setStartAt(Math.max(0, Math.round(num(e.target.value, 1)) - 1))} /></Field>
          </div>
        )}
        <CheckRow checked={layout.showShop} onChange={(v) => set('showShop', v)} label="Shop name" />
        <CheckRow checked={layout.showTamil} onChange={(v) => set('showTamil', v)} label="Tamil name" />
        <CheckRow checked={layout.showPrice} onChange={(v) => set('showPrice', v)} label="Price" />
        {can('settings.manage') && <Button variant="outline" size="sm" onClick={() => void saveDefault()}><Save /> Save as shop default</Button>}
        <p className="text-xs text-muted-foreground">Install your label printer's driver and pick the same paper size in its settings (margins zero). The printer is then chosen in the system print window.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {prev ? <span><b>{prev.labels}</b> label{prev.labels === 1 ? '' : 's'} on <b>{prev.pages}</b> {layout.kind === 'thermal' ? 'roll label' : 'sheet'}{prev.pages === 1 ? '' : 's'}</span> : <Spinner />}
          {prev && prev.labels > 0 && <span className={thin ? 'text-warning' : 'text-muted-foreground'}>· bar width {prev.moduleMm.toFixed(2)} mm {thin ? '(too thin - use a bigger label or hide text)' : '(good for scanning)'}</span>}
          <span className="ml-auto flex gap-2">
            <Button variant="outline" disabled={busy || !prev || prev.labels === 0} onClick={() => void run('pdf')}><FileDown /> Save as PDF</Button>
            <Button disabled={busy || !prev || prev.labels === 0} onClick={() => void run('print')} data-testid="print-labels"><Printer /> Print labels</Button>
          </span>
        </div>
        {prev && prev.skipped.length > 0 && (
          <Notice>
            {prev.skipped.length} product{prev.skipped.length === 1 ? '' : 's'} skipped: {prev.skipped.slice(0, 4).map((s) => `${s.nameEn} (${s.reason})`).join('; ')}{prev.skipped.length > 4 ? '…' : ''}
          </Notice>
        )}
        {error && <Notice tone="red">{error}</Notice>}
        {items.length === 0 ? (
          <div className="flex items-center justify-center rounded-md border border-dashed border-border py-16 text-sm text-muted-foreground">Select products to preview their labels.</div>
        ) : (
          prev && <iframe title="Label preview" sandbox="" srcDoc={prev.html} className="w-full rounded-md border border-border bg-muted" style={{ height: previewHeight }} />
        )}
      </div>
    </div>
  );
}
