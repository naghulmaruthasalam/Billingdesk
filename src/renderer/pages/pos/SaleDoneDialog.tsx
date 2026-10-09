import { useState } from 'react';
import { CheckCircle2, Eye, FileDown, Printer, Plus } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Kbd, Notice } from '@/components/ui/misc';
import { formatINR } from '@shared/money';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useShortcuts, loadShortcuts } from '@/hooks/useShortcuts';
import type { InvoiceDTO } from '@/lib/types';
import { InvoicePrintDialog } from '@/components/InvoicePrintDialog';
import { useNavigate } from 'react-router-dom';

export function SaleDoneDialog({ invoice, onNewBill }: { invoice: InvoiceDTO | null; onNewBill: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const open = invoice !== null;

  const run = async (mode: 'print' | 'pdf') => {
    if (!invoice) return;
    setBusy(true);
    setPrintError(null);
    try {
      const r = await call<{ printed?: boolean; saved?: boolean; path?: string }>('print:invoice', { id: invoice.id, mode });
      if (r.printed) toast.success('Sent to the printer');
      if (r.saved) toast.success(`Saved PDF: ${r.path}`);
    } catch (e) {
      setPrintError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  useShortcuts({ printDocument: () => void run('print'), newBill: onNewBill }, open && !preview);

  return (
    <>
      <Dialog open={open && !preview} onOpenChange={() => undefined} locked title="Sale completed" description="The bill has been saved and stock updated." footer={
        <>
          <Button variant="outline" onClick={() => setPreview(true)}>
            <Eye /> Preview / reprint
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void run('pdf')}>
            <FileDown /> Save PDF
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void run('print')} data-testid="print-bill">
            <Printer /> Print <Kbd>{loadShortcuts().printDocument}</Kbd>
          </Button>
          <Button autoFocus onClick={onNewBill} data-testid="new-bill">
            <Plus /> New bill <Kbd>{loadShortcuts().newBill}</Kbd>
          </Button>
        </>
      }>
        {invoice && (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <div className="text-sm text-muted-foreground">Invoice</div>
            <div className="text-xl font-semibold" data-testid="invoice-no">{invoice.invoiceNo}</div>
            <div className="num text-2xl font-semibold">{formatINR(invoice.totalPaise)}</div>
            {invoice.changePaise > 0 && (
              <div className="rounded-md bg-warning-bg px-4 py-2 text-warning">
                Return change: <span className="num inline font-semibold">{formatINR(invoice.changePaise)}</span>
              </div>
            )}
            {invoice.duePaise > 0 && <div className="rounded-md bg-warning-bg px-4 py-2 text-warning">Balance due: {formatINR(invoice.duePaise)}</div>}
            {printError && (
              <Notice tone="red" className="mt-2 text-left">
                {printError}
                {/confirms|confirm the shop/i.test(printError) && (
                  <button className="ml-2 underline" onClick={() => nav('/settings')}>
                    Open Settings
                  </button>
                )}
              </Notice>
            )}
          </div>
        )}
      </Dialog>
      <InvoicePrintDialog invoiceId={invoice?.id ?? null} invoiceNo={invoice?.invoiceNo} open={open && preview} onOpenChange={setPreview} />
    </>
  );
}
