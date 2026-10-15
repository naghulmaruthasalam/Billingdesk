import { useCallback, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckRow, Field, Select } from '@/components/ui/form';
import { Notice } from '@/components/ui/misc';
import { call, errMsg } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
  status: number;
}

type Kind = 'receipt' | 'label';

/**
 * "Which printer?" step in front of every print. The app prints straight to the chosen printer (no operating-system
 * print dialog). If the shop has chosen "print without asking", the saved/default printer is used with no prompt.
 * `choose()` resolves to `{ printer }` (undefined = let the backend use the saved or default printer) or null if cancelled.
 */
export function usePrinterChoice(kind: Kind) {
  const { settings, reloadSettings, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((v: { printer?: string } | null) => void) | null>(null);

  const finish = useCallback((v: { printer?: string } | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpen(false);
  }, []);

  const choose = useCallback(async (): Promise<{ printer?: string } | null> => {
    const savedKey = kind === 'receipt' ? 'printing.receipt_printer' : 'printing.label_printer';
    if (settings?.['printing.silent']) return {};
    setError(null);
    let list: PrinterInfo[] = [];
    try {
      list = await call<PrinterInfo[]>('printers:list');
    } catch (e) {
      setError(errMsg(e));
    }
    setPrinters(list);
    const saved = settings?.[savedKey] ?? '';
    setSelected(list.find((p) => p.name === saved)?.name ?? list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? '');
    setRemember(false);
    setOpen(true);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, [kind, settings]);

  const confirm = async () => {
    if (remember && can('settings.manage')) {
      try {
        await call('settings:update', { patch: { [kind === 'receipt' ? 'printing.receipt_printer' : 'printing.label_printer']: selected, 'printing.silent': true } });
        await reloadSettings();
      } catch {
        /* the print itself still goes ahead */
      }
    }
    finish({ printer: selected });
  };

  const dialog = (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && finish(null)}
      title={
        <span className="flex items-center gap-2">
          <Printer className="h-4 w-4 text-primary" /> Choose printer
        </span>
      }
      description={kind === 'receipt' ? 'Where should this receipt be printed?' : 'Where should these labels be printed?'}
      footer={
        <>
          <Button variant="outline" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button disabled={!selected} onClick={() => void confirm()} data-testid="printer-confirm">
            <Printer /> Print
          </Button>
        </>
      }
    >
      {printers.length === 0 ? (
        <Notice tone="amber">{error ?? 'No printer is installed on this computer. Add one in the system settings (Linux: Settings → Printers or http://localhost:631), then try again - or use Save as PDF.'}</Notice>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Printer">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Printer to use" autoFocus>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                  {p.isDefault ? ' (system default)' : ''}
                  {p.status === 5 ? ' - stopped' : ''}
                </option>
              ))}
            </Select>
          </Field>
          {can('settings.manage') && <CheckRow checked={remember} onChange={setRemember} label="Always use this printer and don't ask again" hint="Can be changed in Settings → Printers." />}
        </div>
      )}
    </Dialog>
  );

  return { choose, dialog };
}
