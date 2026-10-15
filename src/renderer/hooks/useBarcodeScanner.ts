import { useEffect, useRef } from 'react';

export interface ScannerOptions {
  /** Shortest burst treated as a scan. Barcodes here are 13 digits; manufacturer codes can be shorter. */
  minLength?: number;
  /** Longest pause between two characters of one scan. Scanners send a character every few ms; people take 100+ ms. */
  maxGapMs?: number;
}

type TextEl = HTMLInputElement | HTMLTextAreaElement;
const isTextEl = (el: Element | null): el is TextEl => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

function restoreValue(el: TextEl, value: string): void {
  // React-controlled inputs only notice changes made through the native setter followed by an input event.
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!set) return;
  set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Keyboard-wedge barcode scanners ("HID keyboard" mode - the default for USB scanners) type the code very fast and
 * finish with Enter. This hook recognises such a burst anywhere on the page - whichever field has the cursor - removes
 * the stray characters from that field, swallows the Enter, and hands the code to `onScan`.
 */
export function useBarcodeScanner(onScan: (code: string) => void, opts: ScannerOptions = {}): void {
  const cb = useRef(onScan);
  cb.current = onScan;
  const minLength = opts.minLength ?? 6;
  const maxGap = opts.maxGapMs ?? 50;

  useEffect(() => {
    let buf = '';
    let last = 0;
    let worstGap = 0;
    let snap: { el: TextEl; value: string } | null = null;

    const reset = () => {
      buf = '';
      worstGap = 0;
      snap = null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
      const t = e.timeStamp;
      if (e.key.length === 1) {
        if (buf && t - last > 100) reset();
        if (!buf) {
          const a = document.activeElement;
          snap = isTextEl(a) ? { el: a, value: a.value } : null; // value *before* this first character lands
        } else worstGap = Math.max(worstGap, t - last);
        buf += e.key;
        last = t;
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && buf.length >= minLength && worstGap <= maxGap && t - last <= 100) {
        e.preventDefault();
        e.stopPropagation();
        const code = buf;
        if (snap && snap.el.isConnected && snap.el.value !== snap.value) restoreValue(snap.el, snap.value);
        reset();
        cb.current(code);
        return;
      }
      if (e.key !== 'Shift' && e.key !== 'CapsLock') reset();
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [minLength, maxGap]);
}
