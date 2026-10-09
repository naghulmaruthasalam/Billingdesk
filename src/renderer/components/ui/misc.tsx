import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Loader2 } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-muted text-muted-foreground border border-border',
      green: 'bg-success-bg text-secondary-foreground',
      amber: 'bg-warning-bg text-warning',
      red: 'bg-destructive/15 text-destructive',
      gold: 'bg-accent/20 text-accent-foreground',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-card text-card-foreground', className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} aria-label="Loading" />;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <span>{msg}</span>
      {onRetry && (
        <button className="underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Notice({ tone = 'amber', children, className }: { tone?: 'amber' | 'green' | 'red'; children: React.ReactNode; className?: string }) {
  const cls = tone === 'amber' ? 'border-accent/50 bg-warning-bg text-warning' : tone === 'green' ? 'border-primary/30 bg-success-bg text-secondary-foreground' : 'border-destructive/40 bg-destructive/10 text-destructive';
  return (
    <div role="status" className={cn('rounded-md border px-3 py-2 text-sm', cls, className)}>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 py-px font-sans text-[10px] font-semibold text-muted-foreground">{children}</kbd>;
}

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const Tabs = TabsPrimitive.Root;
export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, ...p }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('mb-4 flex flex-wrap gap-1 border-b border-border', className)} {...p} />
));
TabsList.displayName = 'TabsList';
export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...p }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn('-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary', className)} {...p} />
));
TabsTrigger.displayName = 'TabsTrigger';
export const TabsContent = TabsPrimitive.Content;

/** Scrollable table container with a sticky header. */
export function TableWrap({ children, className, maxHeight }: { children: React.ReactNode; className?: string; maxHeight?: string }) {
  return (
    <div className={cn('overflow-auto rounded-lg border border-border bg-card', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ className, right, ...p }: React.ThHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) => (
  <th className={cn('sticky top-0 z-10 whitespace-nowrap border-b border-border bg-muted px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground', right && 'text-right', className)} {...p} />
);
export const Td = ({ className, right, num, ...p }: React.TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean; num?: boolean }) => (
  <td className={cn('border-b border-border/70 px-3 py-2 align-top', (right || num) && 'text-right', num && 'num', className)} {...p} />
);

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'default' | 'good' }) {
  return (
    <Card className={cn('px-4 py-3', tone === 'good' && 'bg-secondary')}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="num mt-0.5 !text-left text-xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}
