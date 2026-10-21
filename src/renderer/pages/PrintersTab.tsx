import { looksThermal, resolveReceiptMethod, resolveLabelMethod } from '@shared/printers';
import { useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CheckRow, Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, ErrorNote, Loading, Notice } from '@/components/ui/misc';
import { useAsync } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/toast';
import type { ProductDTO } from '@/lib/types';

interface PrinterInfo {
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  model: string;
  status: number;
}

const stateLabel = (s: number): { text: string; tone: 'green' | 'amber' | 'red' | 'neutral' } =>
  s === 3 ? { text: 'ready', tone: 'green' } : s === 4 ? { text: 'printing', tone: 'amber' } : s === 5 ? { text: 'stopped - check printer', tone: 'red' } : { text: 'status not reported', tone: 'neutral' };

/** Choose the receipt printer and the label printer, silent printing, copies, auto-print, and run test prints. */
export function PrintersTab() {
  const { settings, reloadSettings, can } = useAuth();
  const toast = useToast();
  const printers = useAsync(() => call<PrinterInfo[]>('printers:list'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const manage = can('settings.manage');
  if (!settings) return <Loading />;

  const save = async (patch: Record<string, unknown>) => {
    try {
      await call('settings:update', { patch });
      await reloadSettings();
      toast.success('Printer settings saved');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const list = printers.data ?? [];
  const receipt = settings['printing.receipt_printer'];
  const label = settings['printing.label_printer'];
  const selectedReceipt = list.find((p) => p.name === (receipt || list.find((x) => x.isDefault)?.name));
  const platform = typeof navigator !== 'undefined' && /win/i.test(navigator.platform) ? 'win32' : 'linux';
  const selectedLabel = list.find((p) => p.name === (label || list.find((x) => x.isDefault)?.name));
  const labelMethod = resolveLabelMethod(settings['printing.label_method'], selectedLabel, platform);
  const labelHint =
    labelMethod === 'tspl' ? `Label printer detected${selectedLabel ? ` (${selectedLabel.displayName})` : ''}: labels are drawn as pictures and sent in TSPL commands, no driver needed.`
    : labelMethod === 'zpl' ? 'Labels are drawn as pictures and sent in ZPL commands, no driver needed.'
    : labelMethod === 'escpos' ? 'Labels are sent to this receipt printer as ESC/POS pictures, centred on the paper.'
    : 'Normal printing through the printer driver (A4 sticker sheets always use the driver).';
  const usesEscPos = resolveReceiptMethod(settings['printing.receipt_method'], selectedReceipt, platform) === 'escpos';
  const methodHint =
    settings['printing.receipt_method'] === 'auto'
      ? usesEscPos
        ? `Detected a thermal receipt printer${selectedReceipt ? ` (${selectedReceipt.displayName})` : ''}: the receipt is drawn as a picture and sent in ESC/POS commands, no driver needed.`
        : 'Normal printing through the printer driver. Thermal receipt printers (RP-3200, TM-T20, ...) are detected and switched to ESC/POS automatically.'
      : settings['printing.receipt_method'] === 'escpos'
        ? 'The receipt is drawn as a picture and sent in ESC/POS commands. Works without a driver.'
        : 'Normal printing through the printer driver.';
  const options = (current: string) => (
    <>
      <option value="">Ask me which printer each time</option>
      {list.map((p) => (
        <option key={p.name} value={p.name}>
          {p.displayName}
          {p.isDefault ? ' (system default)' : ''}
        </option>
      ))}
      {current && !list.some((p) => p.name === current) && <option value={current}>{current} (not found)</option>}
    </>
  );

  const testReceipt = async () => {
    setBusy('receipt');
    try {
      const r = await call<{ printed?: boolean; printer?: string | null; note?: string | null }>('print:test', { size: settings['invoice.receipt_size'], mode: 'print' });
      if (r.note) toast.info(r.note);
      if (r.printed) toast.success(r.printer ? `Test receipt sent to ${r.printer}` : 'Test receipt sent to the printer');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const testLabel = async () => {
    setBusy('label');
    try {
      const first = (await call<{ rows: ProductDTO[] }>('products:list', { activeOnly: true, limit: 1 })).rows[0];
      if (!first) throw new Error('There are no products to print a test label for.');
      const cols = settings['labels.layout'].kind === 'thermal' ? settings['labels.layout'].rollCols : 1; // one full row of the roll
      const r = await call<{ printed?: boolean; printer?: string | null; note?: string | null }>('print:labels', { items: [{ productId: first.id, copies: cols }], mode: 'print' });
      if (r.note) toast.info(r.note);
      if (r.printed) toast.success(r.printer ? `Test label sent to ${r.printer}` : 'Test label sent to the printer');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const anySelected = !!receipt || !!label;
  return (
    <div className="grid max-w-3xl gap-4">
      <Notice tone="green">Printer choices save immediately - there is no need to press Save changes.</Notice>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Printers known to this computer. Add a printer in the operating system first (Windows: Settings → Printers & scanners; Linux: Settings → Printers or <code>http://localhost:631</code>).</p>
        <Button variant="outline" size="sm" onClick={printers.reload}>
          <RefreshCw /> Refresh
        </Button>
      </div>
      {printers.error ? <ErrorNote error={printers.error} onRetry={printers.reload} /> : !printers.data ? <Loading label="Looking for printers…" /> : list.length === 0 ? (
        <Notice>No printers were found. Install the printer driver, plug the printer in and press Refresh. You can still use <b>Save as PDF</b>.</Notice>
      ) : (
        <Card className="divide-y divide-border">
          {list.map((p) => {
            const st = stateLabel(p.status);
            return (
              <div key={p.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium"><Printer className="h-4 w-4 shrink-0 text-muted-foreground" /> <span className="truncate">{p.displayName}</span> {p.isDefault && <Badge tone="gold">system default</Badge>}</div>
                  {(p.model || p.description) && <div className="truncate text-xs text-muted-foreground">{[p.model, p.description].filter(Boolean).join(' · ')}</div>}
                </div>
                <Badge tone={st.tone}>{st.text}</Badge>
              </div>
            );
          })}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Receipt / invoice printer">
          <Select value={receipt} disabled={!manage} onChange={(e) => void save({ 'printing.receipt_printer': e.target.value })} aria-label="Receipt printer">
            {options(receipt)}
          </Select>
        </Field>
        <Field label="Barcode label printer">
          <Select value={label} disabled={!manage} onChange={(e) => void save({ 'printing.label_printer': e.target.value })} aria-label="Label printer">
            {options(label)}
          </Select>
        </Field>
        <Field label="How labels are sent" hint={labelHint}>
          <Select value={settings['printing.label_method']} disabled={!manage} onChange={(e) => void save({ 'printing.label_method': e.target.value })} aria-label="How labels are sent">
            <option value="auto">Automatic (recommended)</option>
            <option value="driver">Printer driver (normal printers, A4 sheets)</option>
            <option value="tspl">Label printer - TSPL (TVS LP 46, TSC ... Linux, no driver)</option>
            <option value="zpl">Label printer - ZPL (Zebra mode, Linux, no driver)</option>
            <option value="escpos">Receipt printer - ESC/POS (Linux, no driver)</option>
          </Select>
        </Field>
        {labelMethod === 'tspl' || labelMethod === 'zpl' ? (
          <div className="flex flex-col justify-end gap-1">
            <Select value={String(settings['printing.label_dpi'])} disabled={!manage} onChange={(e) => void save({ 'printing.label_dpi': Number(e.target.value) as 203 | 300 })} aria-label="Label printer resolution">
              <option value="203">203 dpi (most label printers, TVS LP 46 Lite)</option>
              <option value="300">300 dpi</option>
            </Select>
            <CheckRow checked={settings['printing.label_rotate']} disabled={!manage} onChange={(v) => void save({ 'printing.label_rotate': v })} label="Labels come out upside down - rotate 180°" />
            <CheckRow checked={settings['printing.label_invert']} disabled={!manage} onChange={(v) => void save({ 'printing.label_invert': v })} label="Labels print inverted (white on black) - swap" />
          </div>
        ) : <div />}
        <Field label="How receipts are sent" hint={methodHint}>
          <Select value={settings['printing.receipt_method']} disabled={!manage} onChange={(e) => void save({ 'printing.receipt_method': e.target.value })} aria-label="How receipts are sent">
            <option value="auto">Automatic (recommended)</option>
            <option value="driver">Printer driver (normal printers, A4)</option>
            <option value="escpos">Thermal receipt printer - ESC/POS (Linux, no driver needed)</option>
          </Select>
        </Field>
        {usesEscPos ? (
          <div className="flex items-end">
            <CheckRow checked={settings['printing.cut']} disabled={!manage} onChange={(v) => void save({ 'printing.cut': v })} label="Cut the paper after each receipt" hint="Ignored by printers without a cutter." />
          </div>
        ) : <div />}
        <Field label="Receipt copies" hint="Printed for every receipt">
          <Input type="number" min={1} max={5} className="w-24" disabled={!manage} defaultValue={settings['printing.receipt_copies']} onBlur={(e) => { const n = Math.max(1, Math.min(5, Math.round(Number(e.target.value) || 1))); if (n !== settings['printing.receipt_copies']) void save({ 'printing.receipt_copies': n }); }} />
        </Field>
        <div className="flex flex-col justify-end gap-2">
          <CheckRow checked={settings['printing.silent']} disabled={!manage || !anySelected} onChange={(v) => void save({ 'printing.silent': v })} label="Don't ask - always use the printer chosen here" hint={anySelected ? 'Receipts and labels go straight to it (the system default printer if one is not chosen).' : 'Choose a printer first.'} />
          <CheckRow checked={settings['printing.auto_print']} disabled={!manage} onChange={(v) => void save({ 'printing.auto_print': v })} label="Print the receipt automatically after each sale" />
        </div>
      </div>

      {(receipt && !list.some((p) => p.name === receipt)) || (label && !list.some((p) => p.name === label)) ? (
        <Notice tone="red">A saved printer is not connected or no longer installed. Printing will use the system default printer until it is back or you pick another printer.</Notice>
      ) : null}

      {settings['printing.receipt_method'] === 'driver' && looksThermal(selectedReceipt) && (
        <Notice tone="amber">
          <b>This looks like a thermal receipt printer.</b> If its queue uses a text-only or no driver, nothing will print in "Printer driver" mode.{' '}
          <Button size="sm" variant="outline" className="ml-1" disabled={!manage} onClick={() => void save({ 'printing.receipt_method': 'auto' })}>Use automatic mode</Button>
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void testReceipt()}><Printer /> Print test receipt</Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => void testLabel()}><Printer /> Print test label</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Paper size comes from Invoices & printing (receipts) and Products → Barcode labels (labels). In the printer's own driver settings choose the same paper size with zero margins. Thermal receipt printers work through their normal driver (Windows) or CUPS queue (Linux).
      </p>
    </div>
  );
}
