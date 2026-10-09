import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (v: T | undefined) => void;
}

/** Load data with an async function; re-runs when `deps` change. Ignores out-of-date responses. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (mine === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (mine === seq.current) setError(e);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Debounce a changing value (for search-as-you-type). */
export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
