import { useEffect } from 'react';

/** Apply the saved theme ('light' | 'dark' | 'system') to <html data-theme>. */
export function useTheme(theme: 'light' | 'dark' | 'system' | undefined): void {
  useEffect(() => {
    const t = theme ?? 'light';
    const apply = () => {
      const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    if (t !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
