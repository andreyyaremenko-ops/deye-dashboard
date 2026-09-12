/** Віджет «Доба»: сонце і споживання за 24 год, оновлення раз на 5 хв. */
import { useEffect, useState } from "preact/hooks";
import { areaPath, fmtPower, hhmm, linePath, niceTicks, scaleLinear } from "@deye/shared/chart";

interface Pt { t: string; pv_w?: number; load_w?: number; grid_w?: number }

export function ChartWidget({ token, deviceId, cls, stale, hours }: { token: string; deviceId: string | undefined; cls: string; stale: boolean; hours: number }) {
  const [pts, setPts] = useState<Pt[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!deviceId) return;
    let stop = false;
    const load = () => fetch(`/api/public/screens/${encodeURIComponent(token)}/history?deviceId=${deviceId}&metrics=pv_w,load_w&hours=${hours}&step=${hours > 48 ? "1h" : "15m"}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (!stop) { setPts(d.points); setErr(null); } })
      .catch((e) => { if (!stop) setErr(e === 409 ? "Історія доступна в тарифі Pro" : "немає даних"); });
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { stop = true; clearInterval(t); };
  }, [token, deviceId, hours]);

  const W = 1000, H = 420, L = 70, R = 16, T = 20, B = 44;
  let body;
  if (err) body = <div class="sub">{err}</div>;
  else if (!pts) body = <div class="sub">…</div>;
  else {
    const now = Date.now(), from = now - hours * 3600_000;
    const x = scaleLinear([from, now], [L, W - R]);
    const max = Math.max(100, ...pts.map((p) => Math.max(p.pv_w ?? 0, p.load_w ?? 0)));
    const ticks = niceTicks(max);
    const y = scaleLinear([0, ticks[ticks.length - 1]!], [H - B, T]);
    const series = (k: "pv_w" | "load_w") => pts.map((p) => ({ x: x(Date.parse(p.t)), y: p[k] == null ? null : y(p[k]!) }));
    const pv = series("pv_w"), load = series("load_w");
    const xt: number[] = []; for (let h = Math.ceil(from / 3600_000) * 3600_000; h <= now; h += 3600_000) if (new Date(h).getHours() % (hours > 48 ? 24 : 4) === 0) xt.push(h);
    body = <svg viewBox={`0 0 ${W} ${H}`} class="chart" preserveAspectRatio="none">
      {ticks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class="grid" /><text x={L - 8} y={y(v) + 5} class="lbl" text-anchor="end">{fmtPower(v)}</text></g>)}
      {xt.map((h) => <text key={h} x={x(h)} y={H - B + 24} class="lbl" text-anchor="middle">{hours > 48 ? new Date(h).toLocaleDateString("uk-UA", { day: "numeric", month: "short" }) : hhmm(new Date(h))}</text>)}
      <path d={areaPath(pv, y(0))} class="area-pv" />
      <path d={linePath(pv)} class="line-pv" />
      <path d={linePath(load)} class="line-load" />
    </svg>;
  }
  return <div class={cls + " w-chart"}>
    <div class="title">Доба{stale && <span class="badge">дані застарілі</span>}<span class="legend"><i class="sw sw-pv" />сонце <i class="sw sw-load" />споживання</span></div>
    {body}
  </div>;
}
