import { useEffect, useState } from 'react';
import { Printer, FileDown } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, Field } from '@/components/ui/form';
import { ErrorNote, Loading, Kbd } from '@/components/ui/misc';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { useShortcuts, loadShortcuts } from '@/hooks/useShortcuts';

type Size = '58mm' | '80mm' | 'a4';

/** Print preview, print and Save-as-PDF for a finalized invoice (used for first print and reprints). */
export function InvoicePrintDialog({ invoiceId, invoiceNo, open, onOpenChange }: { invoiceId: number | null; invoiceNo?: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { settings } = useAuth();
  const toast = useToast();
  const [size, setSize] = useState<Size>('80mm');
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && settings) setSize(settings['invoice.receipt_size']);
  }, [open, settings]);

  useEffect(() => {
    if (!open || !invoiceId) return;
    let alive = true;
    setHtml(null);
    setError(null);
    call<{ html: string }>('invoice:html', { id: invoiceId, size })
      .then((r) => alive && setHtml(r.html))
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [open, invoiceId, size]);

  const run = async (mode: 'print' | 'pdf') => {
    if (!invoiceId) return;
    setBusy(true);
    try {
      const r = await call<{ printed?: boolean; cancelled?: boolean; saved?: boolean; path?: string }>('print:invoice', { id: invoiceId, size, mode });
      if (r.printed) toast.success('Sent to the printer');
      if (r.saved) toast.success(`Saved PDF: ${r.path}`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  useShortcuts({ printDocument: () => void run('print') }, open);
  const key = loadShortcuts().printDocument;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Print preview${invoiceNo ? ` - ${invoiceNo}` : ''}`}
      description="The preview is exactly what will be printed."
      className="max-w-3xl"
      footer={
        <>
          <Field label="" className="mr-auto">
            <Select aria-label="Paper size" value={size} onChange={(e) => setSize(e.target.value as Size)} className="w-44">
              <option value="58mm">58 mm thermal</option>
              <option value="80mm">80 mm thermal</option>
              <option value="a4">A4 invoice</option>
            </Select>
          </Field>
          <Button variant="outline" onClick={() => void run('pdf')} disabled={busy || !html}>
            <FileDown /> Save as PDF
          </Button>
          <Button onClick={() => void run('print')} disabled={busy || !html}>
            <Printer /> Print <Kbd>{key}</Kbd>
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorNote error={error} />
      ) : !html ? (
        <Loading label="Preparing preview…" />
      ) : (
        <div className="flex justify-center rounded-md bg-muted p-3">
          <iframe title="Invoice preview" sandbox="" srcDoc={html} className="h-[58vh] w-full rounded border border-border bg-white" style={{ maxWidth: size === 'a4' ? 780 : size === '80mm' ? 340 : 270 }} />
        </div>
      )}
    </Dialog>
  );
}
