import { useState } from 'react';
import { KeyRound, Store } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Dialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/misc';
import { call, errMsg } from '@/lib/api';

export function LoginPage() {
  const { needsSetup, signIn, setupOwner } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (needsSetup) {
      if (password.length < 6) return setError('Choose a password of at least 6 characters');
      if (password !== confirm) return setError('The passwords do not match');
    }
    setBusy(true);
    try {
      if (needsSetup) setRecoveryCode(await setupOwner({ username: username.trim(), displayName: displayName.trim() || username.trim(), password }));
      else await signIn(username.trim(), password);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-muted p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <div className="text-base font-semibold leading-tight">Sri Krishna Pattasu Kadai</div>
            <div className="ta text-sm text-muted-foreground">ஸ்ரீ கிருஷ்ணா பட்டாசு கடை</div>
          </div>
        </div>
        <h1 className="mb-1 text-lg font-semibold">{needsSetup ? 'First-time setup' : 'Sign in'}</h1>
        {needsSetup && <p className="mb-3 text-sm text-muted-foreground">Create the owner account. There is no default password - you choose it now.</p>}
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Username">
            <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={needsSetup ? 3 : 1} />
          </Field>
          {needsSetup && (
            <Field label="Your name">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          )}
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={needsSetup ? 'new-password' : 'current-password'} required />
          </Field>
          {needsSetup && (
            <Field label="Confirm password">
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </Field>
          )}
          {error && <Notice tone="red">{error}</Notice>}
          <Button type="submit" disabled={busy || !username || !password} className="mt-1">
            {busy ? 'Please wait…' : needsSetup ? 'Create owner account' : 'Sign in'}
          </Button>
        </form>
        {!needsSetup && (
          <button className="mt-4 flex items-center gap-1 text-xs text-muted-foreground underline" onClick={() => setRecovering(true)}>
            <KeyRound className="h-3 w-3" /> Forgot the owner password?
          </button>
        )}
      </div>

      <Dialog open={recoveryCode !== null} onOpenChange={() => undefined} locked title="Save your recovery code" description="Shown only once.">
        <p className="mb-3 text-sm">If the owner password is ever forgotten, this code resets it without deleting any sales or stock data. Write it down and keep it somewhere safe, away from the counter.</p>
        <div className="num !text-center select-all rounded-md border border-border bg-muted py-3 font-mono text-lg font-semibold tracking-wider" data-testid="recovery-code">
          {recoveryCode}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I have saved this code
        </label>
        <div className="mt-4 flex justify-end">
          <Button disabled={!ack} onClick={() => setRecoveryCode(null)}>
            Continue
          </Button>
        </div>
      </Dialog>
      <RecoverDialog open={recovering} onOpenChange={setRecovering} />
    </div>
  );
}

function RecoverDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<{ recoveryCode: string }>('auth:recover', { recoveryCode: code, newPassword: pw });
      setNewCode(r.recoveryCode);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setNewCode(null);
        onOpenChange(o);
      }}
      title="Reset owner password"
      description="Uses your recovery code. No sales, stock or product data is touched."
      footer={
        newCode ? (
          <Button onClick={() => onOpenChange(false)}>Back to sign in</Button>
        ) : (
          <Button onClick={() => void run()} disabled={busy || code.length < 8 || pw.length < 6}>
            Reset password
          </Button>
        )
      }
    >
      {newCode ? (
        <div className="flex flex-col gap-2">
          <Notice tone="green">Password changed. A new recovery code was issued - the old one no longer works.</Notice>
          <div className="num !text-center select-all rounded-md border border-border bg-muted py-3 font-mono text-lg font-semibold tracking-wider">{newCode}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Recovery code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" />
          </Field>
          <Field label="New password" hint="At least 6 characters">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          {err && <Notice tone="red">{err}</Notice>}
        </div>
      )}
    </Dialog>
  );
}
