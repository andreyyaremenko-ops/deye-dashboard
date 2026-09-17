/**
 * Потік енергії, як у Deye Cloud: сонце, батарея, мережа, споживання навколо інвертора.
 * Знаки метрик: bat_w > 0 розряд, < 0 заряд; grid_w > 0 з мережі, < 0 у мережу; pv_w і load_w ≥ 0.
 * Скіни: orbit (вузли навколо інвертора, анімовані лінії), strip (компактний рядок стрілок), bars (смуги з часткою від навантаження).
 */
import { gridDown } from "@deye/shared/energy";
import { fmtW } from "./widgets.tsx";
import { BatteryIcon, BoltIcon, GridOffIcon, HouseIcon, InverterIcon, SunIcon } from "./icons.tsx";

/** Іконка вузла за видом: pv / grid / grid off / bat / load / inv. */
function Icon({ kind, soc, cls }: { kind: string; soc?: number | null; cls: string }) {
  const k = kind.split(" ")[0];
  if (k === "pv") return <SunIcon class={cls} />;
  if (k === "grid") return kind.includes("off") ? <GridOffIcon class={cls} /> : <BoltIcon class={cls} />;
  if (k === "bat") return <BatteryIcon class={cls} soc={soc} />;
  if (k === "inv") return <InverterIcon class={cls} />;
  return <HouseIcon class={cls} />;
}

type M = Record<string, number | string | boolean>;
const num = (m: M | undefined, k: string): number | null => (typeof m?.[k] === "number" ? (m[k] as number) : null);
const DEAD = 20;   // Вт: менше — «немає потоку»

export interface Flows {
  pv: number | null; load: number | null; bat: number | null; grid: number | null; soc: number | null;
  outage: boolean;
}
export function flowsOf(m: M | undefined): Flows {
  return { pv: num(m, "pv_w"), load: num(m, "load_w"), bat: num(m, "bat_w"), grid: num(m, "grid_w"), soc: num(m, "bat_soc"), outage: !!m && gridDown(m) };
}
/** Напрям потоку по лінії: +1 у бік інвертора/будинку, -1 від нього, 0 немає. */
const dir = (w: number | null, invert = false): -1 | 0 | 1 => (w === null || Math.abs(w) < DEAD ? 0 : (w > 0) !== invert ? 1 : -1);
/** Швидкість анімації: сильніший потік — швидше (0.9…3.5 с на цикл). */
const speed = (w: number | null) => `${Math.max(0.9, 3.5 - Math.min(3000, Math.abs(w ?? 0)) / 1000)}s`;

export function FlowWidget({ cls, state, props, stale }: { cls: string; state: M | undefined; props: Record<string, unknown>; stale: boolean }) {
  const skin = String(props.skin ?? "orbit");
  const f = flowsOf(state);
  const plain = props.card === false;
  const c = `${cls} w-flow flow-${skin}${plain ? " flow-plain" : ""}`;
  const title = String(props.title ?? "Потік енергії");
  return <div class={c}>
    {!plain && <div class="title">{title}{stale && <span class="badge">дані застарілі</span>}</div>}
    {skin === "strip" ? <Strip f={f} /> : skin === "bars" ? <Bars f={f} /> : <Orbit f={f} />}
  </div>;
}

/* ---------- orbit: SVG, вузли навколо інвертора ---------- */
function Orbit({ f }: { f: Flows }) {
  // viewBox 400x320 (підписи над верхніми і під нижніми вузлами входять у рамку); pv зверху-ліворуч, grid знизу-ліворуч, bat знизу-праворуч, load зверху-праворуч
  const C = { x: 200, y: 158 };
  const N = { pv: { x: 75, y: 80 }, grid: { x: 75, y: 236 }, load: { x: 325, y: 80 }, bat: { x: 325, y: 236 } };
  const line = (n: { x: number; y: number }) => `M${n.x},${n.y} L${C.x},${C.y}`;
  const dPv = dir(f.pv), dGrid = dir(f.grid), dBat = dir(f.bat), dLoad = f.load !== null && f.load >= DEAD ? -1 : 0;
  return <svg class="orbit" viewBox="0 0 400 320" preserveAspectRatio="xMidYMid meet">
    <Line d={line(N.pv)} dir={dPv} w={f.pv} kind="pv" />
    <Line d={line(N.grid)} dir={f.outage ? 0 : dGrid} w={f.grid} kind="grid" />
    <Line d={line(N.bat)} dir={dBat} w={f.bat} kind="bat" />
    <Line d={line(N.load)} dir={dLoad} w={f.load} kind="load" />
    <Node n={C} r={26} kind="inv" />
    <Node n={N.pv} r={30} kind="pv" label="Сонце" value={fmtW(f.pv)} dim={dPv === 0} />
    <Node n={N.grid} r={30} kind={f.outage ? "grid off" : "grid"} label={f.outage ? "Мережі немає" : f.grid !== null && f.grid < -DEAD ? "У мережу" : "Мережа"} value={f.outage ? "—" : fmtW(f.grid === null ? null : Math.abs(f.grid))} dim={!f.outage && dGrid === 0} />
    <Node n={N.bat} r={30} kind={`bat${f.soc !== null && f.soc <= 30 ? " low" : ""}`} soc={f.soc} label={f.soc === null ? "Батарея" : `Батарея ${f.soc}%`} value={dBat === 0 ? "спокій" : `${dBat > 0 ? "розряд" : "заряд"} ${fmtW(Math.abs(f.bat!))}`} dim={dBat === 0} />
    <Node n={N.load} r={30} kind="load" label="Споживання" value={fmtW(f.load)} />
  </svg>;
}
function Line({ d, dir: dd, w, kind }: { d: string; dir: -1 | 0 | 1; w: number | null; kind: string }) {
  return <g class={`fl fl-${kind}${dd === 0 ? " idle" : ""}`}>
    <path class="fl-base" d={d} />
    {dd !== 0 && <path class="fl-dots" d={d} style={{ animationDuration: speed(w), animationDirection: dd > 0 ? "normal" : "reverse" }} />}
  </g>;
}
function Node({ n, r, kind, soc, label, value, dim }: { n: { x: number; y: number }; r: number; kind: string; soc?: number | null; label?: string; value?: string; dim?: boolean }) {
  const below = n.y > 158;
  const s = r * 1.15;
  return <g class={`fn fn-${kind}${dim ? " dim" : ""}`} transform={`translate(${n.x},${n.y})`}>
    <circle r={r} class="fn-c" />
    <svg x={-s / 2} y={-s / 2} width={s} height={s} viewBox="0 0 24 24" class="fn-i"><Icon kind={kind} soc={soc} cls="ico" /></svg>
    {label && <text class="fn-l" y={below ? r + 18 : -r - 26} text-anchor="middle">{label}</text>}
    {value && <text class="fn-v" y={below ? r + 38 : -r - 6} text-anchor="middle">{value}</text>}
  </g>;
}

/* ---------- strip: компактний рядок ---------- */
function Strip({ f }: { f: Flows }) {
  const dGrid = f.outage ? 0 : dir(f.grid), dBat = dir(f.bat), dPv = dir(f.pv);
  const arrow = (d: -1 | 0 | 1, w: number | null) => <span class={`fs-a${d === 0 ? " idle" : d > 0 ? " in" : " out"}`} style={{ animationDuration: speed(w) }}>{d === 0 ? "·" : d > 0 ? "▶" : "◀"}</span>;
  return <div class="strip">
    <Cell kind="pv" label="Сонце" value={fmtW(f.pv)} dim={dPv === 0} />
    {arrow(dPv, f.pv)}
    <Cell kind="load" label="Споживання" value={fmtW(f.load)} big />
    {arrow(dGrid === 0 ? 0 : dGrid > 0 ? -1 : 1, f.grid)}
    <Cell kind={f.outage ? "grid off" : "grid"} label={f.outage ? "немає" : f.grid !== null && f.grid < -DEAD ? "У мережу" : "Мережа"} value={f.outage ? "—" : fmtW(f.grid === null ? null : Math.abs(f.grid))} dim={!f.outage && dGrid === 0} />
    <span class="fs-sep" />
    <Cell kind={`bat${f.soc !== null && f.soc <= 30 ? " low" : ""}`} soc={f.soc} label={dBat === 0 ? "спокій" : dBat > 0 ? "розряд" : "заряд"} value={f.soc === null ? "—" : `${f.soc}%`} sub={dBat === 0 ? "" : fmtW(Math.abs(f.bat!))} dim={dBat === 0} />
  </div>;
}
function Cell({ kind, soc, label, value, sub, big, dim }: { kind: string; soc?: number | null; label: string; value: string; sub?: string; big?: boolean; dim?: boolean }) {
  return <div class={`fs-c fs-${kind}${big ? " big" : ""}${dim ? " dim" : ""}`}>
    <div class="fs-i"><Icon kind={kind} soc={soc} cls="ico" /></div>
    <div class="fs-v">{value}</div>
    <div class="fs-l">{label}{sub ? ` · ${sub}` : ""}</div>
  </div>;
}

/* ---------- bars: смуги, частка від споживання ---------- */
function Bars({ f }: { f: Flows }) {
  const load = Math.max(f.load ?? 0, DEAD);
  const pct = (w: number | null) => Math.min(100, Math.round((Math.max(0, w ?? 0) / load) * 100));
  const rows: { kind: string; label: string; w: number | null; note: string }[] = [
    { kind: "pv", label: "Сонце", w: f.pv, note: "" },
    { kind: "bat", label: f.bat !== null && f.bat < -DEAD ? "У батарею" : "З батареї", w: f.bat !== null && f.bat < -DEAD ? -f.bat : f.bat, note: f.soc === null ? "" : `${f.soc}%` },
    { kind: f.outage ? "grid off" : "grid", label: f.outage ? "Мережі немає" : f.grid !== null && f.grid < -DEAD ? "У мережу" : "З мережі", w: f.outage ? 0 : f.grid !== null && f.grid < -DEAD ? -f.grid : f.grid, note: "" },
    { kind: "load", label: "Споживання", w: f.load, note: "" },
  ];
  return <div class="bars">
    {rows.map((r) => <div key={r.kind} class={`fb fb-${r.kind}${(r.w ?? 0) < DEAD ? " idle" : ""}`}>
      <span class="fb-i"><Icon kind={r.kind} soc={f.soc} cls="ico" /></span>
      <span class="fb-l">{r.label}{r.note ? <small> {r.note}</small> : null}</span>
      <span class="fb-bar"><span class="fb-fill" style={{ width: `${r.kind === "load" ? 100 : pct(r.w)}%` }} /></span>
      <span class="fb-v">{r.kind.startsWith("grid off") ? "—" : fmtW(r.w === null ? null : Math.abs(r.w))}</span>
    </div>)}
  </div>;
}
