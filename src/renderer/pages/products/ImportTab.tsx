import { useState } from 'react';
import { Download, FileUp, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Notice, TableWrap, Td, Th } from '@/components/ui/misc';
import { CheckRow } from '@/components/ui/form';
import { call, errMsg } from '@/lib/api';
import { openTextFile, saveFileResult } from '@/lib/files';
import { useToast } from '@/components/ui/toast';
import { formatINR } from '@shared/money';
import type { FileResult, ImportPreview } from '@/lib/types';

export function ImportTab({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const exportCsv = async (channel: 'catalogue:export' | 'util:csvTemplate') => {
    try {
      const r = await call<FileResult>(channel);
      const s = await saveFileResult(r);
      if (s.saved) toast.success(`Saved ${s.path}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const choose = async () => {
    setErr(null);
    try {
      const f = await openTextFile(['csv'], 'CSV files');
      if (!f) return;
      setFile(f);
      setAccept(false);
      setPreview(await call<ImportPreview>('catalogue:importPreview', { text: f.text }));
    } catch (e) {
      setPreview(null);
      setErr(errMsg(e));
    }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await call<{ created: number; updated: number; skipped: number }>('catalogue:importCommit', { text: file.text, acceptWarnings: accept });
      toast.success(`Imported: ${r.created} added, ${r.updated} updated, ${r.skipped} skipped`);
      setFile(null);
      setPreview(null);
      onImported();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const s = preview?.summary;
  const hasWarnings = (s?.warnings ?? 0) > 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void exportCsv('catalogue:export')}>
          <Download /> Export catalogue (CSV)
        </Button>
        <Button variant="outline" onClick={() => void exportCsv('util:csvTemplate')}>
          <Download /> Download blank template
        </Button>
        <Button onClick={() => void choose()}>
          <FileUp /> Choose CSV to import…
        </Button>
      </div>
      <Notice>Nothing is saved until you review the preview and press Import. Stock quantities are not part of this file - use Inventory → Opening stock. Existing products are matched by SKU. Printed rates are always preserved for comparison.</Notice>
      {err && <Notice tone="red">{err}</Notice>}
      {preview && s && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{file?.name}</span>
            <Badge tone="green">{s.create} new</Badge>
            <Badge tone="gold">{s.update} changed</Badge>
            <Badge>{s.unchanged} unchanged</Badge>
            <Badge tone={s.errors ? 'red' : 'neutral'}>{s.errors} with errors (skipped)</Badge>
            <Badge tone={s.warnings ? 'amber' : 'neutral'}>{s.warnings} with warnings</Badge>
            <Badge tone={s.missingPrice ? 'amber' : 'neutral'}>{s.missingPrice} missing price</Badge>
            {preview.newCategories.length > 0 && <Badge tone="amber">New categories: {preview.newCategories.join(', ')}</Badge>}
          </div>
          <TableWrap maxHeight="46vh">
            <thead>
              <tr>
                <Th>Line</Th>
                <Th>Action</Th>
                <Th>SKU</Th>
                <Th>Name</Th>
                <Th>Category</Th>
                <Th right>Price</Th>
                <Th>Changes / issues</Th>
              </tr>
            </thead>
            <tbody>
              {preview.rows
                .filter((r) => r.action !== 'unchanged')
                .map((r) => (
                  <tr key={r.line}>
                    <Td num>{r.line}</Td>
                    <Td>
                      <Badge tone={r.action === 'error' ? 'red' : r.action === 'create' ? 'green' : 'gold'}>{r.action}</Badge>
                    </Td>
                    <Td>{r.sku}</Td>
                    <Td>
                      <div>{r.nameEn}</div>
                      <div className="ta text-xs text-muted-foreground">{r.nameTa}</div>
                    </Td>
                    <Td>{r.category}</Td>
                    <Td num>{r.pricePaise === null ? '—' : formatINR(r.pricePaise)}</Td>
                    <Td className="text-xs">
                      {r.changes.map((c) => (
                        <div key={c.field}>
                          {c.field}: <s>{c.from || '∅'}</s> → {c.to || '∅'}
                        </div>
                      ))}
                      {r.issues.map((i, k) => (
                        <div key={k} className={i.severity === 'error' ? 'text-destructive' : 'text-warning'}>
                          {i.severity === 'error' ? '✖' : '⚠'} {i.message}
                        </div>
                      ))}
                    </Td>
                  </tr>
                ))}
            </tbody>
          </TableWrap>
          <div className="flex items-center justify-between">
            {hasWarnings ? <CheckRow checked={accept} onChange={setAccept} label="I have read the warnings and want to import these rows anyway" hint="Entries with unreadable names are imported flagged for review." /> : <span />}
            <Button disabled={busy || (hasWarnings && !accept) || s.create + s.update === 0} onClick={() => void commit()}>
              <Upload /> Import {s.create + s.update} products
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
