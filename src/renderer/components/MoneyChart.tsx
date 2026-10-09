import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatINR } from '@shared/money';

/** Resolve theme CSS variables to concrete colours (SVG presentation attributes do not accept var()). Re-reads on theme change. */
function useThemeColors() {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    const g = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    return { primary: g('--primary', '#155d43'), border: g('--border', '#dcd8c9'), muted: g('--muted', '#f5f1e5'), mutedFg: g('--muted-foreground', '#5b6b63'), card: g('--card', '#ffffff') };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setC(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return c;
}

/** Restrained single-series bar chart of paise values (primary green). */
export function MoneyBars({ data, xKey, yKey, label, height = 220, horizontal }: { data: Record<string, string | number | null>[]; xKey: string; yKey: string; label: string; height?: number; horizontal?: boolean }) {
  const c = useThemeColors();
  const rows = data.map((d) => ({ ...d, [yKey]: Number(d[yKey] ?? 0) }));
  const axis = { fontSize: 11, fill: c.mutedFg } as const;
  const fmtTick = (v: number) => (v >= 10000000 ? `₹${Math.round(v / 100000) / 10}L` : v >= 100000 ? `₹${Math.round(v / 100) / 1000}k` : `₹${Math.round(v / 100)}`);
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 60 : 0 }}>
          <CartesianGrid stroke={c.border} strokeDasharray="3 3" vertical={horizontal ? true : false} horizontal={horizontal ? false : true} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={axis} tickFormatter={fmtTick} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey={xKey} tick={axis} width={110} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tick={axis} axisLine={{ stroke: c.border }} tickLine={false} />
              <YAxis tick={axis} tickFormatter={fmtTick} axisLine={false} tickLine={false} width={56} />
            </>
          )}
          <Tooltip cursor={{ fill: c.muted }} formatter={(v) => [formatINR(Number(v)), label]} contentStyle={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 6, fontSize: 12 }} />
          <Bar dataKey={yKey} fill={c.primary} radius={[3, 3, 0, 0]} maxBarSize={38} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
