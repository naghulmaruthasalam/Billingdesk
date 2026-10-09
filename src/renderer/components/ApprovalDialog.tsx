import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { ShieldCheck } from 'lucide-react';
import type { Approval } from '@/lib/types';

/** Supervisor approval: an owner enters their credentials to authorise one operation for the signed-in user. */
export function ApprovalDialog({ open, onOpenChange, reason, onApproved }: { open: boolean; onOpenChange: (o: boolean) => void; reason: string; onApproved: (a: Approval) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const submit = () => {
    if (!username || !password) return;
    onApproved({ username, password });
    setPassword('');
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" /> Supervisor approval
        </span>
      }
      description={reason}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!username || !password}>
            Approve
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Supervisor username">
          <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Supervisor password" hint="Used for this action only. The person approving is recorded in the audit log.">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
