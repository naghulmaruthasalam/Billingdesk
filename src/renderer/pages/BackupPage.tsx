import { useState } from 'react';
import { DatabaseBackup, Download, FolderOpen, HardDriveDownload, ShieldCheck, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CheckRow, Field, Input } from '@/components/ui/form';
import { Badge, Card, Empty, ErrorNote, Loading, Notice, PageHeader, TableWrap, Td, Th } from '@/components/ui/misc';
import { useAsync } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { saveFileResult } from '@/lib/files';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { fmtDateTime } from '@/lib/utils';
import type { AppInfo, BackupInfo, BackupInspection, FileResult, IntegrityResult } from '@/lib/types';

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function BackupPage() {
  const toast = useToast();
  const { settings, reloadSettings, refresh } = useAuth();
  const list = useAsync(() => call<{ dir: string; backups: BackupInfo[] }>('backup:list'), []);
  const info = useAsync(() => call<AppInfo>('app:info'), []);
  const [busy, setBusy] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [inspect, setInspect] = useState<{ file: string; result: BackupInspection } | null>(null);
  const [pw, setPw] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const backup = async (choose: boolean) => {
    setBusy(true);
    try {
      let dir: string | null = null;
      if (choose) {
        dir = await call<string | null>('dialog:chooseFolder');
        if (!dir) return;
      }
      const r = await call<BackupInfo>('backup:createTo', { dir });
      toast.success(`Backup saved: ${r.file}`);
      list.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file?: string) => {
    setErr(null);
    try {
      const f = file ?? (await call<string | null>('dialog:chooseBackupFile'));
      if (!f) return;
      setInspect({ file: f, result: await call<BackupInspection>('backup:inspect', { file: f }) });
      setPw('');
      setAck(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const restore = async () => {
    if (!inspect) return;
    setBusy(true);
    setErr(null);
    try {
      await call('backup:restore', { file: inspect.file, confirmPassword: pw });
      toast.success('Backup restored. Please sign in again.');
      setInspect(null);
      await refresh();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const runIntegrity = async () => {
    try {
      setIntegrity(await call<IntegrityResult>('backup:integrity'));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const saveSetting = async (patch: Record<string, unknown>) => {
    try {
      await call('settings:update', { patch });
      await reloadSettings();
      list.reload();
      toast.success('Backup settings saved');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const exportFile = async (channel: 'catalogue:export' | 'settings') => {
    try {
      let f: FileResult;
      if (channel === 'settings') {
        const s = await call<Record<string, unknown>>('settings:get');
        delete s['shop.logo_data_url'];
        f = { filename: 'business-settings.json', mime: 'application/json', text: JSON.stringify(s, null, 2) };
      } else f = await call<FileResult>('catalogue:export');
      const r = await saveFileResult(f);
      if (r.saved) toast.success(`Saved ${r.path}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const newest = list.data?.backups[0];
  const chooseDir = async () => {
    const dir = await call<string | null>('dialog:chooseFolder');
    if (dir) await saveSetting({ 'backup.directory': dir });
  };

  return (
    <div>
      <PageHeader title="Backup & restore" subtitle="Backups are consistent snapshots of the whole database (safe while the shop is billing)." actions={<><Button variant="outline" disabled={busy} onClick={() => void backup(true)}><FolderOpen /> Back up to a folder…</Button><Button disabled={busy} onClick={() => void backup(false)} data-testid="backup-now"><DatabaseBackup /> Back up now</Button></>} />
      {info.data?.lastBackupError && <Notice tone="red" className="mb-3">The last automatic backup failed: {info.data.lastBackupError}. Check that the backup folder exists, is writable and has free space.</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Backups in {list.data?.dir ?? '…'}</h2>
          {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.backups.length === 0 ? <Empty>No backups yet. Press “Back up now”.</Empty> : (
            <TableWrap maxHeight="50vh">
              <thead><tr><Th>File</Th><Th>Type</Th><Th>Created</Th><Th right>Size</Th><Th> </Th></tr></thead>
              <tbody>
                {list.data.backups.map((b) => (
                  <tr key={b.name}><Td className="font-mono text-xs">{b.name}</Td><Td><Badge tone={b.label === 'auto' ? 'green' : b.label === 'manual' ? 'gold' : 'neutral'}>{b.label}</Badge></Td><Td className="whitespace-nowrap text-xs">{fmtDateTime(b.createdAt)}</Td><Td num>{fmtSize(b.sizeBytes)}</Td><Td><Button size="sm" variant="outline" onClick={() => void pick(b.file)}>Restore…</Button></Td></tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void pick()}><Upload /> Restore from another file…</Button>
            <Button variant="outline" onClick={() => void runIntegrity()}><ShieldCheck /> Check database integrity</Button>
            <Button variant="outline" onClick={() => void exportFile('catalogue:export')}><Download /> Export catalogue (CSV)</Button>
            <Button variant="outline" onClick={() => void exportFile('settings')}><Download /> Export business settings</Button>
          </div>
          {integrity && (integrity.ok ? <Notice tone="green">Integrity check passed: the database is healthy.</Notice> : <Notice tone="red">Integrity problems found: {integrity.messages.join('; ')}. Restore the latest good backup.</Notice>)}
        </div>
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><HardDriveDownload className="h-4 w-4" /> Automatic backup</div>
          {settings && (
            <>
              <CheckRow checked={settings['backup.auto_enabled']} onChange={(v) => void saveSetting({ 'backup.auto_enabled': v })} label="Back up automatically once a day" hint="Taken when the application is open; also before database upgrades." />
              <Field label="Keep the newest N automatic backups" hint="Manual, pre-upgrade and pre-restore backups are never deleted automatically.">
                <Input type="number" min={1} max={365} defaultValue={settings['backup.retention_count']} onBlur={(e) => { const n = Number(e.target.value); if (n >= 1 && n !== settings['backup.retention_count']) void saveSetting({ 'backup.retention_count': n }); }} />
              </Field>
              <Field label="Backup folder" hint={settings['backup.directory'] ? undefined : 'Using the default folder inside the application data directory.'}>
                <div className="flex gap-2"><Input readOnly value={settings['backup.directory'] || list.data?.dir || ''} className="font-mono text-xs" /><Button variant="outline" onClick={() => void chooseDir()}>Change</Button></div>
              </Field>
              {settings['backup.directory'] && <Button variant="ghost" size="sm" onClick={() => void saveSetting({ 'backup.directory': '' })}>Use default folder</Button>}
              <p className="text-xs text-muted-foreground">Last automatic backup: {settings['backup.last_auto_date'] || 'never'}{newest ? ` · newest file ${fmtDateTime(newest.createdAt)}` : ''}</p>
              <Notice>A backup in the same computer does not protect against a failed disk. Copy backups to a USB drive regularly.</Notice>
            </>
          )}
        </Card>
      </div>

      <Dialog
        open={inspect !== null}
        onOpenChange={(o) => !o && setInspect(null)}
        locked={busy}
        title="Restore from backup"
        description={inspect?.file}
        className="max-w-xl"
        footer={<><Button variant="outline" disabled={busy} onClick={() => setInspect(null)}>Cancel</Button><Button variant="destructive" disabled={busy || !inspect?.result.valid || !ack || !pw} onClick={() => void restore()} data-testid="confirm-restore">Replace current data with this backup</Button></>}
      >
        {inspect && (
          <div className="flex flex-col gap-3">
            {inspect.result.valid ? (
              <>
                <Notice tone="green">This file is a valid, intact backup.</Notice>
                <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Bills</dt><dd>{inspect.result.counts.invoices}{inspect.result.lastInvoiceNo ? ` (latest ${inspect.result.lastInvoiceNo}, ${inspect.result.lastInvoiceDate})` : ''}</dd>
                  <dt className="text-muted-foreground">Products</dt><dd>{inspect.result.counts.products}</dd>
                  <dt className="text-muted-foreground">Users</dt><dd>{inspect.result.counts.users}</dd>
                  <dt className="text-muted-foreground">File date</dt><dd>{fmtDateTime(inspect.result.fileModified)} · {fmtSize(inspect.result.sizeBytes)}</dd>
                  <dt className="text-muted-foreground">Schema</dt><dd>version {inspect.result.schemaVersion}{inspect.result.needsMigration ? ' (will be upgraded automatically)' : ''}</dd>
                </dl>
                <Notice tone="amber"><b>Warning:</b> everything entered since this backup was made - bills, stock changes, users - will be replaced. A safety copy of your current data is saved first, and put back automatically if the restore fails. You will be signed out.</Notice>
                <CheckRow checked={ack} onChange={setAck} label="I understand that current data will be overwritten" />
                <Field label="Your password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></Field>
              </>
            ) : (
              <Notice tone="red">This file cannot be restored:<ul className="ml-4 list-disc">{inspect.result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>
            )}
            {err && <Notice tone="red">{err}</Notice>}
          </div>
        )}
      </Dialog>
    </div>
  );
}
