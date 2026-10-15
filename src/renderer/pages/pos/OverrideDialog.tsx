import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Notice } from '@/components/ui/misc';
import { bpToPercent, percentToBp } from '@shared/money';

/** Change the discount of the whole bill away from the shop policy. A reason is mandatory; the change is audited. */
export function OverrideDialog({ open, policyBp, overridden, onClose, onApply }: { open: boolean; policyBp: number | null; overridden: boolean; onClose: () => void; onApply: (bp: number | null, reason: string) => void }) {
  const [pct, setPct] = useState('');
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const policy = policyBp;
  const bp = percentToBp(pct);
  const valid = bp !== null && reason.trim().length >= 3;
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
      description={`Whole bill - shop policy: ${policy === null ? 'set per product' : `${bpToPercent(policy)}%`}`}
      footer={
        step === 'edit' ? (
          <>
            {overridden && (
              <Button
                variant="outline"
                className="mr-auto"
                onClick={() => {
                  onApply(null, '');
                  reset();
                  onClose();
                }}
              >
                Restore shop discount
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!valid || (policy !== null && bp === policy)} onClick={() => setStep('confirm')}>
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
          <Notice>This sets one discount for the whole bill, on the items that are normally discounted. Items with no discount (such as gift boxes) stay without. Discounts are never added together.</Notice>
          <Field label="Discount %" error={pct && bp === null ? 'Enter a number from 0 to 100' : null}>
            <Input autoFocus inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder={policy === null ? '' : bpToPercent(policy)} />
          </Field>
          <Field label="Reason (required)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Regular customer, damaged box" />
          </Field>
        </div>
      ) : (
        <p className="text-sm">
          The discount for the <b>whole bill</b> will change from the shop policy of <b>{policy === null ? 'per-product rules' : `${bpToPercent(policy)}%`}</b> to <b>{bp !== null ? bpToPercent(bp) : ''}%</b>. This is recorded in the audit log with your reason, and may need supervisor approval when the bill is completed.
        </p>
      )}
    </Dialog>
  );
}
