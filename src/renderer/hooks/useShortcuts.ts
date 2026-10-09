import { useEffect, useRef } from 'react';

export type ShortcutAction = 'focusSearch' | 'editLine' | 'selectPayment' | 'completeSale' | 'printDocument' | 'newBill';

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  focusSearch: 'Focus product search',
  editLine: 'Edit quantity of selected line',
  selectPayment: 'Select payment method',
  completeSale: 'Complete payment',
  printDocument: 'Print current document',
  newBill: 'Start a new bill',
};

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  focusSearch: 'F2',
  editLine: 'F4',
  selectPayment: 'F6',
  completeSale: 'F8',
  printDocument: 'Ctrl+P',
  newBill: 'F9',
};

const KEY = 'skb.shortcuts.v1';

/** Shortcuts are a per-device preference, so they live in localStorage (the UI works if it is unavailable). */
export function loadShortcuts(): Record<ShortcutAction, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SHORTCUTS, ...(JSON.parse(raw) as Partial<Record<ShortcutAction, string>>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SHORTCUTS };
}

export function saveShortcuts(s: Record<ShortcutAction, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** Normalise a keyboard event to "Ctrl+Shift+F8" style text. */
export function eventToCombo(e: KeyboardEvent | React.KeyboardEvent): string | null {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(k.length === 1 ? k.toUpperCase() : k);
  return parts.join('+');
}

/** Combos that would clash with essential OS / text-editing actions. */
export const RESERVED_COMBOS = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Alt+F4', 'Ctrl+W', 'Ctrl+Q', 'Ctrl+R', 'F5', 'F11', 'F12', 'Tab', 'Enter', 'Escape', 'Alt+Tab', 'Ctrl+Alt+Delete']);

export function useShortcuts(map: Partial<Record<ShortcutAction, () => void>>, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const combo = eventToCombo(e);
      if (!combo) return;
      const shortcuts = loadShortcuts();
      for (const action of Object.keys(shortcuts) as ShortcutAction[]) {
        if (shortcuts[action] === combo && ref.current[action]) {
          e.preventDefault();
          ref.current[action]!();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
