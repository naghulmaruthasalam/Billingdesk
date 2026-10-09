import * as React from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const Ctx = React.createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);
  const push = React.useCallback((kind: ToastKind, message: string) => {
    const id = ++idRef.current;
    setItems((x) => [...x.slice(-3), { id, kind, message }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 3500);
  }, []);
  const api = React.useMemo<ToastApi>(() => ({ success: (m) => push('success', m), error: (m) => push('error', m), info: (m) => push('info', m) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={cn('pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg', t.kind === 'error' ? 'border-destructive/50 bg-card text-destructive' : t.kind === 'success' ? 'border-primary/40 bg-card' : 'border-border bg-card')}>
            {t.kind === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="flex-1">{t.message}</span>
            <button aria-label="Dismiss" className="opacity-60 hover:opacity-100" onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('ToastProvider missing');
  return c;
}
