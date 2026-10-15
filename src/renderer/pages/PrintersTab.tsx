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
  const options = (current: string) => (
    <>
      <option value="">Ask each time (system print window)</option>
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
      const r = await call<{ printed?: boolean; printer?: string | null; note?: string | null }>('print:labels', { items: [{ productId: first.id, copies: 1 }], mode: 'print' });
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
                  {p.description && <div className="truncate text-xs text-muted-foreground">{p.description}</div>}
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
        <Field label="Receipt copies" hint="Printed for every receipt">
          <Input type="number" min={1} max={5} className="w-24" disabled={!manage} defaultValue={settings['printing.receipt_copies']} onBlur={(e) => { const n = Math.max(1, Math.min(5, Math.round(Number(e.target.value) || 1))); if (n !== settings['printing.receipt_copies']) void save({ 'printing.receipt_copies': n }); }} />
        </Field>
        <div className="flex flex-col justify-end gap-2">
          <CheckRow checked={settings['printing.silent']} disabled={!manage || !anySelected} onChange={(v) => void save({ 'printing.silent': v })} label="Print without the print window" hint={anySelected ? 'Goes straight to the chosen printer.' : 'Choose a printer first.'} />
          <CheckRow checked={settings['printing.auto_print']} disabled={!manage} onChange={(v) => void save({ 'printing.auto_print': v })} label="Print the receipt automatically after each sale" />
        </div>
      </div>

      {(receipt && !list.some((p) => p.name === receipt)) || (label && !list.some((p) => p.name === label)) ? (
        <Notice tone="red">A saved printer is not connected or no longer installed. Printing will use the system print window until it is back or you pick another printer.</Notice>
      ) : null}

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
