import { useState } from 'react';
import { ApiError, errMsg } from '@/lib/api';
import { ApprovalDialog } from '@/components/ApprovalDialog';
import { useToast } from '@/components/ui/toast';
import type { Approval } from '@/lib/types';

/**
 * Runs an operation; when the backend says a supervisor must approve it (the signed-in user lacks the permission),
 * shows the approval dialog and re-runs the operation with the supervisor's credentials.
 */
export function useWithApproval(reason: string) {
  const toast = useToast();
  const [pending, setPending] = useState<((a: Approval) => Promise<void>) | null>(null);

  const run = async (fn: (approval?: Approval) => Promise<void>, onError?: (message: string) => void): Promise<void> => {
    const fail = (e: unknown) => (onError ? onError(errMsg(e)) : toast.error(errMsg(e)));
    try {
      await fn(undefined);
    } catch (e) {
      if (e instanceof ApiError && e.needsApproval) setPending(() => async (a: Approval) => fn(a).catch(fail));
      else fail(e);
    }
  };

  const dialog = (
    <ApprovalDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
      reason={reason}
      onApproved={(a) => {
        const p = pending;
        setPending(null);
        void p?.(a);
      }}
    />
  );
  return { run, dialog };
}
