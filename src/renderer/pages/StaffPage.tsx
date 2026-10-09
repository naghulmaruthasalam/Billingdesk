import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, CheckRow, Field, Input, Select } from '@/components/ui/form';
import { Badge, Empty, ErrorNote, Loading, Notice, PageHeader, TableWrap, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from '@/components/ui/misc';
import { useAsync, useDebounced } from '@/hooks/useApi';
import { call, errMsg } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { fmtDateTime } from '@/lib/utils';
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from '@shared/permissions';
import type { AuditRow, RoleDTO, UserDTO } from '@/lib/types';

export function StaffPage() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Staff & permissions" subtitle="Permissions are enforced by the application's backend, not just hidden in the interface." />
      <Tabs defaultValue={can('users.manage') ? 'users' : 'audit'}>
        <TabsList>
          {can('users.manage') && <TabsTrigger value="users">Users</TabsTrigger>}
          {can('users.manage') && <TabsTrigger value="roles">Role permissions</TabsTrigger>}
          {can('audit.view') && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>
        {can('users.manage') && <TabsContent value="users"><UsersTab /></TabsContent>}
        {can('users.manage') && <TabsContent value="roles"><RolesTab /></TabsContent>}
        {can('audit.view') && <TabsContent value="audit"><AuditTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

function UsersTab() {
  const toast = useToast();
  const { user: me } = useAuth();
  const users = useAsync(() => call<UserDTO[]>('users:list'), []);
  const roles = useAsync(() => call<RoleDTO[]>('roles:list'), []);
  const [edit, setEdit] = useState<UserDTO | 'new' | null>(null);
  const [f, setF] = useState({ username: '', displayName: '', roleId: 0, password: '', active: true, confirm: '' });
  const [err, setErr] = useState<string | null>(null);

  const open = (u: UserDTO | 'new') => {
    setEdit(u);
    setErr(null);
    const cashier = roles.data?.find((r) => r.name === 'cashier')?.id ?? roles.data?.[0]?.id ?? 0;
    setF(u === 'new' ? { username: '', displayName: '', roleId: cashier, password: '', active: true, confirm: '' } : { username: u.username, displayName: u.displayName, roleId: roles.data?.find((r) => r.name === u.role)?.id ?? 0, password: '', active: u.active, confirm: '' });
  };
  const save = async () => {
    try {
      if (edit === 'new') await call('users:create', { username: f.username, displayName: f.displayName, password: f.password, roleId: f.roleId });
      else if (edit) await call('users:update', { id: edit.id, data: { displayName: f.displayName, roleId: f.roleId, active: f.active, newPassword: f.password || undefined }, confirmPassword: f.confirm });
      toast.success('User saved');
      setEdit(null);
      users.reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => open('new')} disabled={!roles.data}><Plus /> Add user</Button></div>
      {users.error ? <ErrorNote error={users.error} onRetry={users.reload} /> : !users.data ? <Loading /> : (
        <TableWrap>
          <thead><tr><Th>Username</Th><Th>Name</Th><Th>Role</Th><Th>Last sign-in</Th><Th>Status</Th><Th> </Th></tr></thead>
          <tbody>
            {users.data.map((u) => (
              <tr key={u.id}><Td className="font-medium">{u.username}{u.id === me?.id && <Badge tone="green" className="ml-2">you</Badge>}</Td><Td>{u.displayName}</Td><Td>{u.roleLabel}</Td><Td className="whitespace-nowrap text-xs">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'never'}</Td><Td>{u.active ? <Badge tone="green">active</Badge> : <Badge tone="red">disabled</Badge>}</Td><Td><Button size="sm" variant="outline" onClick={() => open(u)}>Edit</Button></Td></tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add user' : `Edit ${f.username}`} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!f.displayName.trim() || (edit === 'new' ? !f.username || f.password.length < 6 : !f.confirm)} onClick={() => void save()}>Save user</Button></>}>
        <div className="flex flex-col gap-3">
          {edit === 'new' && <Field label="Username" hint="Letters, digits, dot, dash, underscore"><Input autoFocus value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>}
          <Field label="Display name"><Input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
          <Field label="Role"><Select value={f.roleId} onChange={(e) => setF({ ...f, roleId: Number(e.target.value) })}>{roles.data?.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></Field>
          <Field label={edit === 'new' ? 'Password (min 6 characters)' : 'Reset password (leave empty to keep)'}><Input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
          {edit !== 'new' && <CheckRow checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Account enabled" hint="Disabled users cannot sign in. Their sales history is kept." />}
          {edit !== 'new' && <Field label="Confirm with your own password"><Input type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="current-password" /></Field>}
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      </Dialog>
    </div>
  );
}

function RolesTab() {
  const toast = useToast();
  const roles = useAsync(() => call<RoleDTO[]>('roles:list'), []);
  const [draft, setDraft] = useState<Record<number, Set<Permission>>>({});
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const perms = (r: RoleDTO) => draft[r.id] ?? new Set(r.permissions);
  const toggle = (r: RoleDTO, p: Permission, v: boolean) => {
    const s = new Set(perms(r));
    if (v) s.add(p); else s.delete(p);
    setDraft((d) => ({ ...d, [r.id]: s }));
  };
  const save = async (r: RoleDTO) => {
    try {
      await call('roles:setPermissions', { roleId: r.id, permissions: [...perms(r)], confirmPassword: confirm });
      toast.success(`${r.label} permissions saved`);
      setSaving(null);
      setConfirm('');
      setDraft((d) => { const n = { ...d }; delete n[r.id]; return n; });
      roles.reload();
    } catch (e) { setErr(errMsg(e)); }
  };
  if (roles.error) return <ErrorNote error={roles.error} onRetry={roles.reload} />;
  if (!roles.data) return <Loading />;
  const dirty = (r: RoleDTO) => !!draft[r.id] && [...draft[r.id]].sort().join() !== [...r.permissions].sort().join();
  return (
    <div className="flex flex-col gap-3">
      <Notice>The Owner role always has every permission. Changes apply to signed-in users immediately.</Notice>
      <TableWrap>
        <thead><tr><Th>Permission</Th>{roles.data.map((r) => <Th key={r.id} right>{r.label}</Th>)}</tr></thead>
        <tbody>
          {PERMISSIONS.map((p) => (
            <tr key={p}>
              <Td>{PERMISSION_LABELS[p]} <span className="text-xs text-muted-foreground">{p}</span></Td>
              {roles.data!.map((r) => (
                <Td key={r.id} right><Checkbox aria-label={`${r.label}: ${PERMISSION_LABELS[p]}`} disabled={r.name === 'owner'} checked={perms(r).has(p)} onCheckedChange={(v) => toggle(r, p, v === true)} /></Td>
              ))}
            </tr>
          ))}
          <tr>
            <Td> </Td>
            {roles.data.map((r) => <Td key={r.id} right>{r.name !== 'owner' && <Button size="sm" disabled={!dirty(r)} onClick={() => { setErr(null); setSaving(r.id); }}>Save</Button>}</Td>)}
          </tr>
        </tbody>
      </TableWrap>
      <Dialog open={saving !== null} onOpenChange={(o) => !o && setSaving(null)} title="Confirm permission change" description="Re-enter your password to change what a role can do." footer={<><Button variant="outline" onClick={() => setSaving(null)}>Cancel</Button><Button disabled={!confirm} onClick={() => { const r = roles.data!.find((x) => x.id === saving); if (r) void save(r); }}>Save permissions</Button></>}>
        <div className="flex flex-col gap-3"><Field label="Your password"><Input autoFocus type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>{err && <Notice tone="red">{err}</Notice>}</div>
      </Dialog>
    </div>
  );
}

function AuditTab() {
  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const dq = useDebounced(q, 250);
  const list = useAsync(() => call<{ rows: AuditRow[]; total: number }>('audit:list', { search: dq || undefined, action: action || undefined, limit: 300 }), [dq, action]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search user or details…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select className="w-64" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action filter">
          <option value="">All events</option><option value="product.price">Price changes</option><option value="billing.">Discount / stock overrides</option><option value="inventory.">Stock adjustments</option><option value="invoice.cancel">Bill cancellations</option><option value="return.">Returns / refunds</option><option value="settings">Settings changes</option><option value="backup.">Backup and restore</option><option value="user.">User changes</option><option value="role.">Permission changes</option><option value="auth.">Sign-ins</option>
        </Select>
      </div>
      {list.error ? <ErrorNote error={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.rows.length === 0 ? <Empty>No events.</Empty> : (
        <TableWrap maxHeight="calc(100vh - 290px)">
          <thead><tr><Th>When</Th><Th>User</Th><Th>Approved by</Th><Th>Event</Th><Th>Details</Th></tr></thead>
          <tbody>
            {list.data.rows.map((r) => (
              <tr key={r.id}><Td className="whitespace-nowrap text-xs">{fmtDateTime(r.ts)}</Td><Td>{r.username ?? '—'}</Td><Td>{r.approver_username ?? ''}</Td><Td className="whitespace-nowrap font-medium">{r.action}</Td><Td className="max-w-xl break-all font-mono text-[11px] text-muted-foreground">{r.entity ? `${r.entity}${r.entity_id ? ` #${r.entity_id}` : ''} ` : ''}{r.details}</Td></tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
