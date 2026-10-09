import { useEffect, useState } from 'react';
import { FolderOpen, ImagePlus, Printer, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CheckRow, Field, Input, Select } from '@/components/ui/form';
import { Badge, Card, Kbd, Loading, Notice, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { call, errMsg } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/toast';
import { useAsync } from '@/hooks/useApi';
import { bpToPercent, percentToBp } from '@shared/money';
import { DEFAULT_SHORTCUTS, RESERVED_COMBOS, SHORTCUT_LABELS, eventToCombo, loadShortcuts, saveShortcuts, type ShortcutAction } from '@/hooks/useShortcuts';
import type { AllSettings, AppInfo } from '@/lib/types';

export function SettingsPage() {
  const { settings, reloadSettings, can } = useAuth();
  const toast = useToast();
  const [d, setD] = useState<AllSettings | null>(null);
  const [phones, setPhones] = useState('');
  const [pct, setPct] = useState('');
  const [taxPct, setTaxPct] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (settings) {
      setD(settings);
      setPhones(settings['shop.phones'].join('\n'));
      setPct(bpToPercent(settings['discount.default_bp']));
      setTaxPct(bpToPercent(settings['tax.rate_bp']));
    }
  }, [settings]);

  if (!d || !settings) return <Loading />;
  const set = <K extends keyof AllSettings>(k: K, v: AllSettings[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const confirmed = settings['setup.address_confirmed'];

  const save = async () => {
    setErr(null);
    const dBp = percentToBp(pct);
    const tBp = percentToBp(taxPct);
    if (dBp === null) return setErr('Default discount must be a percentage from 0 to 100');
    if (tBp === null) return setErr('Tax rate must be a percentage from 0 to 100');
    const patch: Record<string, unknown> = {};
    const next: AllSettings = { ...d, 'shop.phones': phones.split('\n').map((p) => p.trim()).filter(Boolean), 'discount.default_bp': dBp, 'tax.rate_bp': tBp };
    for (const k of Object.keys(next) as (keyof AllSettings)[]) {
      if (k === 'setup.address_confirmed' || k === 'setup.catalogue_approved' || k === 'backup.last_auto_date' || k === 'catalogue.seeded') continue;
      if (JSON.stringify(next[k]) !== JSON.stringify(settings[k])) patch[k] = next[k];
    }
    if (Object.keys(patch).length === 0) return toast.info('No changes to save');
    setBusy(true);
    try {
      await call('settings:update', { patch });
      await reloadSettings();
      toast.success('Settings saved');
      if (['shop.name_en', 'shop.name_ta', 'shop.address', 'shop.address_ta', 'shop.phones'].some((k) => k in patch)) toast.info('Shop details changed - please confirm them again before printing.');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmAddress = async () => {
    try {
      await call('settings:confirmAddress');
      await reloadSettings();
      toast.success('Shop details confirmed. Invoice printing is enabled.');
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 300_000) return setErr('Logo must be smaller than 300 KB');
    const r = new FileReader();
    r.onload = () => set('shop.logo_data_url', String(r.result));
    r.readAsDataURL(file);
  };

  const testPrint = async (mode: 'print' | 'pdf') => {
    try {
      const r = await call<{ printed?: boolean; saved?: boolean; path?: string }>('print:test', { size: d['invoice.receipt_size'], mode });
      if (r.printed) toast.success('Test page sent to the printer');
      if (r.saved) toast.success(`Saved ${r.path}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const manage = can('settings.manage');
  return (
    <div>
      <PageHeader title="Settings" subtitle="Shop details, invoices, discounts, tax and preferences." actions={manage && <Button onClick={() => void save()} disabled={busy}><Save /> Save changes</Button>} />
      {err && <Notice tone="red" className="mb-3">{err}</Notice>}
      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="shop">Shop details</TabsTrigger>
          <TabsTrigger value="invoice">Invoices & printing</TabsTrigger>
          <TabsTrigger value="discount">Discount & tax</TabsTrigger>
          <TabsTrigger value="billing">Billing rules</TabsTrigger>
          <TabsTrigger value="appearance">Appearance & shortcuts</TabsTrigger>
          <TabsTrigger value="account">My account</TabsTrigger>
          <TabsTrigger value="about">About & system</TabsTrigger>
        </TabsList>

        <TabsContent value="shop">
          <div className="grid max-w-3xl gap-4">
            <Notice tone={confirmed ? 'green' : 'amber'}>
              {confirmed ? 'Shop details are confirmed. Editing the name, address or phone numbers withdraws this confirmation.' : 'The address below was transcribed from a photograph of the brochure and may contain spelling errors. Correct it if needed, save, then confirm - invoice printing stays disabled until you do.'}
            </Notice>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Shop name (English)"><Input value={d['shop.name_en']} onChange={(e) => set('shop.name_en', e.target.value)} /></Field>
              <Field label="Shop name (Tamil)"><Input className="ta" value={d['shop.name_ta']} onChange={(e) => set('shop.name_ta', e.target.value)} /></Field>
              <Field label="Address (English)" className="col-span-2"><Input value={d['shop.address']} onChange={(e) => set('shop.address', e.target.value)} /></Field>
              <Field label="Address (Tamil)" className="col-span-2"><Input className="ta" value={d['shop.address_ta']} onChange={(e) => set('shop.address_ta', e.target.value)} /></Field>
              <Field label="Phone numbers (one per line)"><textarea className="min-h-[72px] w-full rounded-md border border-input bg-card px-3 py-2 text-sm" value={phones} onChange={(e) => setPhones(e.target.value)} /></Field>
              <Field label="Tax / GST registration number" hint="Leave empty unless the shop is registered. It is never filled in automatically."><Input value={d['shop.tax_id']} onChange={(e) => set('shop.tax_id', e.target.value)} /></Field>
            </div>
            <div className="flex items-center gap-3">
              {d['shop.logo_data_url'] && <img src={d['shop.logo_data_url']} alt="Shop logo" className="h-12 rounded border border-border" />}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted"><ImagePlus className="h-4 w-4" /> {d['shop.logo_data_url'] ? 'Replace logo' : 'Add logo (PNG/JPG, under 300 KB)'}<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onLogo(e.target.files?.[0])} /></label>
              {d['shop.logo_data_url'] && <Button variant="ghost" size="sm" onClick={() => set('shop.logo_data_url', '')}>Remove</Button>}
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={() => void confirmAddress()} disabled={!manage || confirmed || JSON.stringify(d['shop.address']) !== JSON.stringify(settings['shop.address'])}>
                <ShieldCheck /> I have checked these details - enable invoice printing
              </Button>
              {confirmed ? <Badge tone="green">Confirmed</Badge> : <Badge tone="amber">Not confirmed</Badge>}
              {!confirmed && JSON.stringify(d['shop.address']) !== JSON.stringify(settings['shop.address']) && <span className="text-xs text-muted-foreground">Save your changes first.</span>}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="invoice">
          <div className="grid max-w-3xl grid-cols-2 gap-3">
            <Field label="Invoice prefix" hint="Letters, digits, hyphen. Example: SKP → SKP-000123"><Input value={d['invoice.prefix']} onChange={(e) => set('invoice.prefix', e.target.value)} /></Field>
            <Field label="Number length (digits)"><Input type="number" min={1} max={10} value={d['invoice.pad']} onChange={(e) => set('invoice.pad', Math.max(1, Math.min(10, Number(e.target.value) || 6)))} /></Field>
            <Field label="Default receipt size"><Select value={d['invoice.receipt_size']} onChange={(e) => set('invoice.receipt_size', e.target.value as AllSettings['invoice.receipt_size'])}><option value="58mm">58 mm thermal</option><option value="80mm">80 mm thermal</option><option value="a4">A4 invoice</option></Select></Field>
            <div className="flex items-end"><CheckRow checked={d['invoice.show_tamil']} onChange={(v) => set('invoice.show_tamil', v)} label="Print Tamil names and shop name" /></div>
            <Field label="Footer line (English)"><Input value={d['invoice.footer_en']} onChange={(e) => set('invoice.footer_en', e.target.value)} /></Field>
            <Field label="Footer line (Tamil)"><Input className="ta" value={d['invoice.footer_ta']} onChange={(e) => set('invoice.footer_ta', e.target.value)} /></Field>
            <div className="col-span-2 flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void testPrint('print')} disabled={!manage}><Printer /> Print test page</Button>
              <Button variant="outline" onClick={() => void testPrint('pdf')} disabled={!manage}>Save test page as PDF</Button>
              <span className="text-xs text-muted-foreground">Uses the saved receipt size. The test page is labelled SAMPLE and contains no real sale. Currency is INR; times are Asia/Kolkata.</span>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="discount">
          <div className="grid max-w-3xl grid-cols-2 gap-3">
            <Field label="Default discount %" hint="Applies to products that are discount-eligible. Per-product and per-category rules are in Products."><Input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
            <div />
            <Field label="Rounding is applied"><Select value={d['discount.rounding_scope']} onChange={(e) => set('discount.rounding_scope', e.target.value as AllSettings['discount.rounding_scope'])}><option value="line">Per bill line</option><option value="invoice">On the whole bill</option></Select></Field>
            <Field label="Round discount to nearest"><Select value={d['discount.rounding_unit']} onChange={(e) => set('discount.rounding_unit', e.target.value as AllSettings['discount.rounding_unit'])}><option value="paisa">1 paisa (no visible rounding)</option><option value="rupee">₹1</option></Select></Field>
            <Notice className="col-span-2">Whole-bill rounding calculates the exact discount for all lines first and rounds once; a “rounding adjustment” is recorded when line figures do not add up. Existing bills keep the policy they were created under.</Notice>
            <div className="col-span-2 mt-2 border-t border-border pt-4 text-sm font-semibold">Tax</div>
            <div className="col-span-2"><CheckRow checked={d['tax.enabled']} onChange={(v) => set('tax.enabled', v)} label="Charge tax on bills" hint="Off by default. The shop's registration status is not assumed - turn on only if tax applies." /></div>
            {d['tax.enabled'] && (<>
              <Field label="Tax name"><Input value={d['tax.label']} onChange={(e) => set('tax.label', e.target.value)} /></Field>
              <Field label="Rate %"><Input inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} /></Field>
              <div className="col-span-2"><CheckRow checked={d['tax.inclusive']} onChange={(v) => set('tax.inclusive', v)} label="Prices already include tax" hint="Otherwise tax is added on top of the discounted amount." /></div>
            </>)}
          </div>
        </TabsContent>

        <TabsContent value="billing">
          <div className="grid max-w-2xl gap-3">
            <Field label="When a bill sells more than the recorded stock"><Select value={d['billing.stock_enforcement']} onChange={(e) => set('billing.stock_enforcement', e.target.value as AllSettings['billing.stock_enforcement'])}><option value="enforce">Block unless a user with permission (or a supervisor) overrides</option><option value="warn">Warn only and record the sale</option></Select></Field>
            <CheckRow checked={d['billing.allow_credit']} onChange={(v) => set('billing.allow_credit', v)} label="Allow bills with a pending balance (partial payment)" hint="Pending amounts can be collected later from Sales history." />
          </div>
        </TabsContent>

        <TabsContent value="appearance"><AppearanceTab d={d} set={set} /></TabsContent>
        <TabsContent value="account"><AccountTab /></TabsContent>
        <TabsContent value="about"><AboutTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function AppearanceTab({ d, set }: { d: AllSettings; set: <K extends keyof AllSettings>(k: K, v: AllSettings[K]) => void }) {
  const [map, setMap] = useState(loadShortcuts());
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const onKey = (e: React.KeyboardEvent, a: ShortcutAction) => {
    e.preventDefault();
    if (e.key === 'Escape') return setCapturing(null);
    const c = eventToCombo(e);
    if (!c) return;
    if (RESERVED_COMBOS.has(c)) return setMsg(`${c} is reserved by the operating system or text editing and cannot be used.`);
    const clash = (Object.keys(map) as ShortcutAction[]).find((k) => k !== a && map[k] === c);
    if (clash) return setMsg(`${c} is already used for "${SHORTCUT_LABELS[clash]}".`);
    const next = { ...map, [a]: c };
    setMap(next);
    saveShortcuts(next);
    setCapturing(null);
    setMsg(null);
  };
  return (
    <div className="grid max-w-2xl gap-4">
      <Field label="Theme" hint="Saved for the whole shop. Press Save changes to apply."><Select value={d['ui.theme']} onChange={(e) => set('ui.theme', e.target.value as AllSettings['ui.theme'])}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Follow the computer</option></Select></Field>
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold">Keyboard shortcuts (this computer only)</div>
        <ul className="flex flex-col gap-2">
          {(Object.keys(map) as ShortcutAction[]).map((a) => (
            <li key={a} className="flex items-center justify-between gap-3 text-sm">
              <span>{SHORTCUT_LABELS[a]}</span>
              <span className="flex items-center gap-2">
                {capturing === a ? <input autoFocus readOnly className="h-8 w-40 rounded-md border border-primary px-2 text-center text-xs" value="Press a key combination…" onKeyDown={(e) => onKey(e, a)} onBlur={() => setCapturing(null)} /> : <Kbd>{map[a]}</Kbd>}
                <Button size="sm" variant="outline" onClick={() => { setMsg(null); setCapturing(a); }}>Change</Button>
                <Button size="sm" variant="ghost" disabled={map[a] === DEFAULT_SHORTCUTS[a]} onClick={() => { const n = { ...map, [a]: DEFAULT_SHORTCUTS[a] }; setMap(n); saveShortcuts(n); }}>Reset</Button>
              </span>
            </li>
          ))}
        </ul>
        {msg && <Notice tone="amber" className="mt-3">{msg}</Notice>}
        <p className="mt-3 text-xs text-muted-foreground">Esc always closes a dialog or returns to the bill.</p>
      </Card>
    </div>
  );
}

function AccountTab() {
  const toast = useToast();
  const { user } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setErr(null);
    if (next !== again) return setErr('The new passwords do not match');
    try {
      await call('auth:changePassword', { current: cur, next });
      toast.success('Password changed');
      setCur(''); setNext(''); setAgain('');
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="grid max-w-sm gap-3">
      <p className="text-sm text-muted-foreground">Signed in as <b>{user?.displayName}</b> ({user?.roleLabel}).</p>
      <Field label="Current password"><Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="New password (min 6 characters)"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
      <Field label="Repeat new password"><Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></Field>
      {err && <Notice tone="red">{err}</Notice>}
      <Button onClick={() => void go()} disabled={!cur || !next}>Change password</Button>
    </div>
  );
}

function AboutTab() {
  const { can } = useAuth();
  const info = useAsync(() => call<AppInfo>('app:info'), []);
  const i = info.data;
  return (
    <div className="max-w-2xl">
      {!i ? <Loading /> : (
        <dl className="grid grid-cols-[170px_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Application</dt><dd>{i.name} {i.version}</dd>
          <dt className="text-muted-foreground">Platform</dt><dd>{i.platform} · Electron {i.electron} · Chromium {i.chrome} · Node {i.node}</dd>
          <dt className="text-muted-foreground">Database schema</dt><dd>version {i.schemaVersion} of {i.latestSchemaVersion}</dd>
          <dt className="text-muted-foreground">Data folder</dt><dd className="break-all font-mono text-xs">{i.dataDir}</dd>
          <dt className="text-muted-foreground">Database file</dt><dd className="break-all font-mono text-xs">{i.dbPath}</dd>
          <dt className="text-muted-foreground">Default backup folder</dt><dd className="break-all font-mono text-xs">{i.backupDir}</dd>
          <dt className="text-muted-foreground">Network</dt><dd>Never used. All data stays on this computer.</dd>
        </dl>
      )}
      {can('backup.manage') && <Button className="mt-4" variant="outline" onClick={() => void call('app:showDataFolder')}><FolderOpen /> Open data folder</Button>}
    </div>
  );
}
