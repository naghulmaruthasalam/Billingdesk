import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertPrimitive from '@radix-ui/react-alert-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export const DialogRoot = DialogPrimitive.Root;

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Prevent closing by overlay click / Esc (e.g. while saving). */
  locked?: boolean;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, className, locked }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (locked ? undefined : onOpenChange(o))}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content
          className={cn('fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card text-card-foreground shadow-xl', className)}
          aria-describedby={description ? undefined : undefined}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-3">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className={cn('mt-0.5 text-sm text-muted-foreground', !description && 'sr-only')}>{description ?? String(typeof title === 'string' ? title : 'Dialog')}</DialogPrimitive.Description>
            </div>
            {!locked && (
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X />
                </Button>
              </DialogPrimitive.Close>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/50 px-5 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}

/** Confirmation for destructive or policy-changing operations. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, busy, onConfirm }: ConfirmProps) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/40" />
        <AlertPrimitive.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl">
          <AlertPrimitive.Title className="text-base font-semibold">{title}</AlertPrimitive.Title>
          <AlertPrimitive.Description asChild>
            <div className="mt-2 text-sm text-muted-foreground">{description}</div>
          </AlertPrimitive.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertPrimitive.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                Cancel
              </Button>
            </AlertPrimitive.Cancel>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {busy ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}
