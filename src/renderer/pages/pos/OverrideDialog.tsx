import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Notice } from '@/components/ui/misc';
import { bpToPercent, percentToBp } from '@shared/money';
import type { CartLine } from './cart';

/** Change the discount on one line away from the shop policy. A reason is mandatory; the change is audited. */
export function OverrideDialog({ line, onClose, onApply }: { line: CartLine | null; onClose: () => void; onApply: (bp: number | null, reason: string) => void }) {
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const policy = line?.product.effectiveDiscountBp ?? 0;
  const bp = percentToBp(pct);
  const valid = bp !== null && reason.trim().length >= 3;
  const open = line !== null;
  const reset = () => {
    setStep('edit');
    setPct('');
    setReason('');
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
      title="Change discount"
      description={line ? `${line.product.nameEn} - shop policy: ${bpToPercent(policy)}%` : undefined}
      footer={
        step === 'edit' ? (
          <>
            {line?.overrideBp !== null && line && (
              <Button
                variant="outline"
                className="mr-auto"
                onClick={() => {
                  onApply(null, '');
                  reset();
                  onClose();
                }}
              >
                Restore policy discount
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!valid || bp === policy} onClick={() => setStep('confirm')}>
              Continue
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => setStep('edit')}>
              Back
            </Button>
            <Button
              onClick={() => {
                onApply(bp, reason.trim());
                reset();
                onClose();
              }}
            >
              Yes, change discount
            </Button>
          </>
        )
      }
    >
      {step === 'edit' ? (
        <div className="flex flex-col gap-3">
          <Notice>This replaces the policy discount for this line only; discounts are never added together.</Notice>
          <Field label="Discount %" error={pct && bp === null ? 'Enter a number from 0 to 100' : null}>
            <Input autoFocus inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder={bpToPercent(policy)} />
          </Field>
          <Field label="Reason (required)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Regular customer, damaged box" />
          </Field>
        </div>
      ) : (
        <p className="text-sm">
          The discount for <b>{line?.product.nameEn}</b> will change from the shop policy of <b>{bpToPercent(policy)}%</b> to <b>{bp !== null ? bpToPercent(bp) : ''}%</b>. This is recorded in the audit log with your reason, and may need supervisor approval when the bill is completed.
        </p>
      )}
    </Dialog>
  );
}
