import { areaPath, fmtPower, hhmm, linePath, niceTicks, scaleLinear } from "@deye/shared/chart";

export interface Series { key: string; label: string; color: string; fill?: boolean; unit?: "W" | "%" }
export interface Row { t: string; [k: string]: number | string | null | undefined }

/** Лінійний графік: кілька серій на одній осі Y (W) або у % */
export function LineChart({ rows, series, from, to, unit = "W", height = 260 }: { rows: Row[]; series: Series[]; from: number; to: number; unit?: "W" | "%"; height?: number }) {
  const W = 1000, H = height, L = 64, R = 12, T = 12, B = 34;
  const x = scaleLinear([from, to], [L, W - R]);
  const maxV = unit === "%" ? 100 : Math.max(100, ...rows.flatMap((r) => series.map((s) => Math.abs(Number(r[s.key] ?? 0)))));
  const rawMin = unit === "%" ? 0 : Math.min(0, ...rows.flatMap((r) => series.map((s) => Number(r[s.key] ?? 0))));
  const minV = -rawMin < maxV * 0.02 ? 0 : rawMin; // ледь відʼємні значення не розтягують вісь
  const ticks = unit === "%" ? [0, 25, 50, 75, 100] : niceTicks(maxV);
  const top = ticks[ticks.length - 1]!;
  const bottom = minV < 0 ? -niceTicks(-minV)[niceTicks(-minV).length - 1]! : 0;
  const y = scaleLinear([bottom, top], [H - B, T]);
  const span = to - from;
  const stepMs = span <= 26 * 3600_000 ? 3 * 3600_000 : span <= 8 * 86400_000 ? 86400_000 : 5 * 86400_000;
  const xt: number[] = []; for (let t = Math.ceil(from / stepMs) * stepMs; t <= to; t += stepMs) xt.push(t);
  const fmtX = (t: number) => (span <= 26 * 3600_000 ? hhmm(new Date(t)) : new Date(t).toLocaleDateString("uk-UA", { day: "numeric", month: "short" }));
  const negTicks = bottom < 0 ? niceTicks(-bottom).slice(1).map((v) => -v) : [];
  return <svg viewBox={`0 0 ${W} ${H}`} className="lc" preserveAspectRatio="none">
    {[...negTicks, ...ticks].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "lc-zero" : "lc-grid"} /><text x={L - 6} y={y(v) + 4} className="lc-lbl" textAnchor="end">{unit === "%" ? `${v}%` : fmtPower(v)}</text></g>)}
    {xt.map((t) => <text key={t} x={x(t)} y={H - B + 20} className="lc-lbl" textAnchor="middle">{fmtX(t)}</text>)}
    {series.map((s) => {
      const pts = rows.map((r) => ({ x: x(Date.parse(r.t)), y: r[s.key] == null ? null : y(Number(r[s.key])) }));
      return <g key={s.key}>{s.fill && <path d={areaPath(pts, y(0))} fill={s.color} opacity={0.15} />}<path d={linePath(pts)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" /></g>;
    })}
  </svg>;
}

export function Legend({ series }: { series: Series[] }) {
  return <div className="legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>;
}

/** Стовпчики kWh по днях: кілька серій поруч. */
export function BarChart({ rows, series, height = 240 }: { rows: { day: string; [k: string]: number | string | undefined }[]; series: Series[]; height?: number }) {
  const W = 1000, H = height, L = 56, R = 12, T = 12, B = 34;
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => Number(r[s.key] ?? 0))));
  const ticks = niceTicks(max); const top = ticks[ticks.length - 1]!;
  const y = scaleLinear([0, top], [H - B, T]);
  const slot = (W - L - R) / Math.max(1, rows.length);
  const bw = Math.max(2, (slot * 0.8) / series.length);
  const every = rows.length > 16 ? Math.ceil(rows.length / 8) : 1;
  return <svg viewBox={`0 0 ${W} ${H}`} className="lc" preserveAspectRatio="none">
    {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="lc-grid" /><text x={L - 6} y={y(v) + 4} className="lc-lbl" textAnchor="end">{v}</text></g>)}
    {rows.map((r, i) => <g key={r.day}>
      {series.map((s, j) => { const v = Number(r[s.key] ?? 0); const x0 = L + i * slot + slot * 0.1 + j * bw; return <rect key={s.key} x={x0} y={y(v)} width={bw - 1} height={Math.max(0, y(0) - y(v))} fill={s.color}><title>{r.day} {s.label}: {v} kWh</title></rect>; })}
      {i % every === 0 && <text x={L + i * slot + slot / 2} y={H - B + 20} className="lc-lbl" textAnchor="middle">{r.day.slice(8, 10)}.{r.day.slice(5, 7)}</text>}
    </g>)}
  </svg>;
}
