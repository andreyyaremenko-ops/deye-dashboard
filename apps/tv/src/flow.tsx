/**
 * Потік енергії, як у Deye Cloud: сонце, батарея, мережа, споживання навколо інвертора.
 * Знаки метрик: bat_w > 0 розряд, < 0 заряд; grid_w > 0 з мережі, < 0 у мережу; pv_w, gen_w і load_w ≥ 0.
 * GEN-порт (gen_w) з'являється окремим джерелом, лише якщо він задіяний: у закладу там мікроінвертор,
 * підпис задається props.genLabel. Його потужність не проходить через CT мережі (load = grid + gen + inv).
 * Скіни: orbit (вузли навколо інвертора, вигнуті лінії зі світінням, товщина за потужністю), gauge (кільце: звідки береться
 * споживання), sankey (стрічки джерело → споживач), cards (картки джерел угорі й споживачів унизу), strip (компактний
 * рядок стрілок), bars (смуги з часткою від навантаження).
 * Дизайн orbit/gauge/sankey — за концептами зі Stitch. Без SVG-фільтрів: світіння — ширший напівпрозорий дублікат лінії (старі ТБ).
 */
import { genUsed, gridDown } from "@deye/shared/energy";
import { flowGraph, loadSources, type SinkKind, type SourceKind } from "@deye/shared/flow";
import { fmtW } from "./widgets.tsx";
import { BatteryIcon, BoltIcon, GridOffIcon, HouseIcon, InverterIcon, MicroInverterIcon, SunIcon } from "./icons.tsx";

/** Іконка вузла за видом: pv / gen / grid / grid off / bat / load / inv. x/y/size — для вкладення в SVG. */
function Icon({ kind, soc, cls, x, y, size }: { kind: string; soc?: number | null; cls: string; x?: number; y?: number; size?: number }) {
  const k = kind.split(" ")[0];
  const p = size ? { class: cls, x, y, width: size, height: size } : { class: cls };
  if (k === "pv") return <SunIcon {...p} />;
  if (k === "gen") return <MicroInverterIcon {...p} />;
  if (k === "grid") return kind.includes("off") ? <GridOffIcon {...p} /> : <BoltIcon {...p} />;
  if (k === "bat") return <BatteryIcon {...p} soc={soc} />;
  if (k === "inv") return <InverterIcon {...p} />;
  return <HouseIcon {...p} />;
}

type M = Record<string, number | string | boolean>;
const num = (m: M | undefined, k: string): number | null => (typeof m?.[k] === "number" ? (m[k] as number) : null);
const DEAD = 20;   // Вт: менше — «немає потоку»
export const GEN_LABEL = "Мікроінвертор";

export interface Flows {
  pv: number | null; load: number | null; bat: number | null; grid: number | null; soc: number | null;
  /** GEN-порт: null — не задіяний (у більшості станцій), інакше поточна потужність (вночі 0) */
  gen: number | null;
  outage: boolean;
}
export function flowsOf(m: M | undefined): Flows {
  return { pv: num(m, "pv_w"), load: num(m, "load_w"), bat: num(m, "bat_w"), grid: num(m, "grid_w"), soc: num(m, "bat_soc"),
    gen: m && genUsed(m) ? num(m, "gen_w") : null, outage: !!m && gridDown(m) };
}
/** Напрям потоку по лінії: +1 у бік інвертора/будинку, -1 від нього, 0 немає. */
const dir = (w: number | null, invert = false): -1 | 0 | 1 => (w === null || Math.abs(w) < DEAD ? 0 : (w > 0) !== invert ? 1 : -1);
/** Швидкість анімації: сильніший потік — швидше (0.9…3.5 с на цикл). */
const speed = (w: number | null) => `${Math.max(0.9, 3.5 - Math.min(3000, Math.abs(w ?? 0)) / 1000)}s`;

/** Що показує кожен скін: потоки + підпис GEN-порту. */
interface SkinProps { f: Flows; gl: string }

export function FlowWidget({ cls, state, props, stale, runtime }: { cls: string; state: M | undefined; props: Record<string, unknown>; stale: boolean; runtime?: string | null }) {
  const skin = String(props.skin ?? "orbit");
  const f = flowsOf(state);
  const gl = String(props.genLabel ?? "").trim() || GEN_LABEL;
  const plain = props.card === false;
  const c = `${cls} w-flow flow-${skin}${plain ? " flow-plain" : ""}${f.gen !== null ? " has-gen" : ""}`;
  const title = String(props.title ?? "Потік енергії");
  const rich = skin === "orbit" || skin === "gauge" || skin === "sankey" || skin === "cards";
  return <div class={c}>
    {!plain && <div class="title"><span>{rich && <i class="fl-live" />}{title}</span>{stale && <span class="badge">дані застарілі</span>}</div>}
    {skin === "strip" ? <Strip f={f} gl={gl} /> : skin === "bars" ? <Bars f={f} gl={gl} /> : skin === "gauge" ? <Gauge f={f} gl={gl} /> : skin === "sankey" ? <Sankey f={f} gl={gl} /> : skin === "cards" ? <Cards f={f} gl={gl} /> : <Orbit f={f} gl={gl} />}
    {rich && <Summary f={f} runtime={runtime ?? null} />}
  </div>;
}

/**
 * Підсумковий рядок: автономія (якщо відома ємність батареї) і звідки зараз живиться заклад.
 * GEN-порт рахуємо разом із панелями: типово це мікроінвертор, тобто те саме сонце.
 */
function Summary({ f, runtime }: { f: Flows; runtime: string | null }) {
  const s = loadSources(f);
  const solar = s.pv + s.gen;
  const pct = (v: number) => Math.round(v * 100);
  const source = f.outage ? { cls: "bad", text: "Працюємо від батареї" }
    : !s.load ? null
    : solar >= 0.995 ? { cls: "ok", text: "100% сонячне живлення" }
    : solar >= 0.05 ? { cls: "ok", text: `Сонце ${pct(solar)}% споживання` }
    : s.bat >= 0.5 ? { cls: "bat", text: `Батарея ${pct(s.bat)}% споживання` }
    : { cls: "grid", text: "Живлення з мережі" };
  if (!source && !runtime) return null;
  return <div class={`fl-sum${f.outage ? " outage" : ""}`}>
    {runtime ? <span class="fl-run">{f.outage ? "Залишок" : "Автономія"} ≈ <b>{runtime}</b></span> : <span />}
    {source && <span class={`fl-src fl-src-${source.cls}`}>{source.text}</span>}
  </div>;
}

/* ---------- orbit: SVG, вузли навколо інвертора ---------- */
const C = { x: 200, y: 131 };
/** gen — під інвертором: лінія до хаба йде вертикально вгору й не перетинає цифри під вузлом. */
const N = { pv: { x: 70, y: 58 }, load: { x: 330, y: 58 }, grid: { x: 70, y: 204 }, bat: { x: 330, y: 204 }, gen: { x: 200, y: 216 } };
const R = 30, CIRC = 2 * Math.PI * R;
/** Крива від вузла до інвертора: виходить з вузла горизонтально (не перетинає цифри під вузлом), заходить у хаб зверху/знизу. */
const curve = (n: { x: number; y: number }) => `M${n.x},${n.y} Q${C.x - (C.x - n.x) * 0.12},${n.y} ${C.x},${C.y}`;
/** Товщина лінії за потужністю: 2.5…7 при 0…5 кВт. */
const sw = (w: number | null) => 2.5 + Math.min(1, Math.abs(w ?? 0) / 5000) * 4.5;

function Orbit({ f, gl }: SkinProps) {
  const dPv = dir(f.pv), dGrid = f.outage ? 0 : dir(f.grid), dBat = dir(f.bat), dLoad = f.load !== null && f.load >= DEAD ? -1 : 0;
  const dGen = dir(f.gen);
  const low = f.soc !== null && f.soc <= 30;
  return <svg class="orbit" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
    <Line d={curve(N.pv)} dir={dPv} w={f.pv} kind="pv" />
    <Line d={curve(N.grid)} dir={dGrid} w={f.grid} kind="grid" />
    <Line d={curve(N.bat)} dir={dBat} w={f.bat} kind="bat" />
    <Line d={curve(N.load)} dir={dLoad} w={f.load} kind="load" />
    {f.gen !== null && <Line d={curve(N.gen)} dir={dGen} w={f.gen} kind="gen" />}
    <g class="fh" transform={`translate(${C.x},${C.y})`}>
      <rect class="fh-glow" x="-36" y="-36" width="72" height="72" rx="20" />
      <rect class="fh-box" x="-29" y="-29" width="58" height="58" rx="15" />
      <InverterIcon x={-15} y={-15} width={30} height={30} class="ico" />
    </g>
    <Node n={N.pv} kind="pv" label="Сонце" value={fmtW(f.pv)} dim={dPv === 0} />
    <Node n={N.load} kind="load" label="Споживання" value={fmtW(f.load)} />
    <Node n={N.grid} kind={f.outage ? "grid off" : "grid"} label={f.outage ? "Мережі немає" : f.grid !== null && f.grid < -DEAD ? "У мережу" : "Мережа"}
      value={f.outage ? "—" : fmtW(f.grid === null ? null : Math.abs(f.grid))} dim={!f.outage && dGrid === 0} />
    <Node n={N.bat} kind={`bat${low ? " low" : ""}`} soc={f.soc} label={dBat === 0 ? "Батарея" : dBat > 0 ? "Батарея · розряд" : "Батарея · заряд"}
      value={dBat === 0 ? (f.soc === null ? "—" : `${f.soc}%`) : `${dBat > 0 ? "−" : "+"}${fmtW(Math.abs(f.bat!))}`} dim={dBat === 0} />
    {f.gen !== null && <Node n={N.gen} kind="gen" label={gl} labelMax={128} value={fmtW(f.gen)} dim={dGen === 0} />}
  </svg>;
}
function Line({ d, dir: dd, w, kind }: { d: string; dir: -1 | 0 | 1; w: number | null; kind: string }) {
  const width = sw(w);
  return <g class={`fl fl-${kind}${dd === 0 ? " idle" : ""}`}>
    {dd !== 0 && <path class="fl-glow" d={d} style={{ strokeWidth: width + 8 }} />}
    <path class="fl-base" d={d} style={{ strokeWidth: dd === 0 ? 2.5 : width }} />
    {dd !== 0 && <path class="fl-dots" d={d} style={{ strokeWidth: width, animationDuration: speed(w), animationDirection: dd > 0 ? "normal" : "reverse" }} />}
  </g>;
}
/** Вузол: кільце зі світінням, іконка; у батареї кільце показує заряд, усередині відсоток. Значення і підпис під вузлом. */
function Node({ n, kind, soc, label, value, dim, labelMax }: { n: { x: number; y: number }; kind: string; soc?: number | null; label: string; value: string; dim?: boolean; labelMax?: number }) {
  const isBat = kind.startsWith("bat");
  // довгий власний підпис GEN-порту стискаємо, щоб не наїхав на сусідні вузли (≈8.5 px на літеру)
  const squeeze = labelMax && label.length * 8.5 > labelMax ? labelMax : undefined;
  const lvl = soc === null || soc === undefined ? null : Math.max(0, Math.min(100, soc));
  return <g class={`fn fn-${kind}${dim ? " dim" : ""}`} transform={`translate(${n.x},${n.y})`}>
    <circle r={R + 6} class="fn-glow" />
    <circle r={R} class={`fn-c${isBat && lvl !== null ? " track" : ""}`} />
    {isBat && lvl !== null && <circle r={R} class="fn-arc" transform="rotate(-90)" style={{ strokeDasharray: `${(CIRC * lvl) / 100} ${CIRC}` }} />}
    {isBat && lvl !== null
      ? <><Icon kind={kind} soc={soc} cls="ico" x={-11} y={-19} size={22} /><text class="fn-soc" y="15" text-anchor="middle">{lvl}%</text></>
      : <Icon kind={kind} soc={soc} cls="ico" x={-15} y={-15} size={30} />}
    <text class="fn-v" y={R + 28} text-anchor="middle">{value}</text>
    <text class="fn-l" y={R + 45} text-anchor="middle" textLength={squeeze} lengthAdjust="spacingAndGlyphs">{label}</text>
  </g>;
}

/* ---------- cards: картки джерел угорі, споживачів унизу, інвертор посередині ---------- */
const CD = { h: 64, top: 6, bot: 230, hub: { x: 200, y: 150 }, pad: 4, gap: 10 };
/** Ширина й початки карток для колонки з n елементів (n=3 -> ті самі 124 і 4/138/272, що були). */
function cols(n: number) {
  const w = (400 - 2 * CD.pad - (n - 1) * CD.gap) / n;
  return { w, xs: Array.from({ length: n }, (_, i) => CD.pad + i * (w + CD.gap)) };
}
/** З’єднувач: вертикальна S-крива від центру картки до хаба (або навпаки). */
const link = (x: number, y0: number, y1: number) => `M${x},${y0} C${x},${(y0 + y1) / 2} ${CD.hub.x},${(y0 + y1) / 2} ${CD.hub.x},${y1}`;

function Cards({ f, gl }: SkinProps) {
  const imp = f.outage ? 0 : Math.max(0, f.grid ?? 0);          // з мережі
  const exp = f.outage ? 0 : Math.max(0, -(f.grid ?? 0));       // у мережу
  const dis = Math.max(0, f.bat ?? 0);                          // розряд батареї
  const chg = Math.max(0, -(f.bat ?? 0));                       // заряд батареї
  const soc = f.soc === null ? "" : `${f.soc}%`;
  const low = f.soc !== null && f.soc <= 30;

  const src = [
    { kind: "pv", label: "Сонце", w: f.pv ?? 0, note: "" },
    ...(f.gen !== null ? [{ kind: "gen", label: gl, w: Math.max(0, f.gen), note: "" }] : []),
    { kind: f.outage ? "grid off" : "grid", label: f.outage ? "Мережі немає" : "З мережі", w: imp, note: "" },
    { kind: `bat${low ? " low" : ""}`, label: "Батарея", w: dis, note: soc },
  ];
  const sink = [
    { kind: "load", label: "Споживання", w: f.load ?? 0, note: "" },
    { kind: `bat${low ? " low" : ""}`, label: "Заряд", w: chg, note: soc },
    { kind: f.outage ? "grid off" : "grid", label: "У мережу", w: exp, note: "" },
  ];
  const S = cols(src.length), K = cols(sink.length);

  return <svg class={`cards${src.length > 3 ? " cards-wide" : ""}`} viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
    {src.map((s, i) => <Line key={`s${i}`} d={link(S.xs[i]! + S.w / 2, CD.top + CD.h, CD.hub.y - 26)}
      dir={s.w >= DEAD ? 1 : 0} w={s.w} kind={s.kind.split(" ")[0]!} />)}
    {sink.map((s, i) => <Line key={`k${i}`} d={link(K.xs[i]! + K.w / 2, CD.bot, CD.hub.y + 26)}
      dir={s.w >= DEAD ? -1 : 0} w={s.w} kind={s.kind.split(" ")[0]!} />)}
    <g class="fh" transform={`translate(${CD.hub.x},${CD.hub.y})`}>
      <rect class="fh-glow" x="-32" y="-32" width="64" height="64" rx="18" />
      <rect class="fh-box" x="-26" y="-26" width="52" height="52" rx="14" />
      <InverterIcon x={-13} y={-13} width={26} height={26} class="ico" />
    </g>
    {src.map((s, i) => <Tile key={`ts${i}`} x={S.xs[i]!} y={CD.top} bw={S.w} {...s} soc={f.soc} />)}
    {sink.map((s, i) => <Tile key={`tk${i}`} x={K.xs[i]!} y={CD.bot} bw={K.w} {...s} soc={f.soc} />)}
  </svg>;
}

/** Картка: підпис, велика цифра, крапка стану; неактивна (нуль) — приглушена. */
function Tile({ x, y, bw, kind, label, w, note, soc }: { x: number; y: number; bw: number; kind: string; label: string; w: number; note: string; soc: number | null }) {
  const idle = w < DEAD;
  const off = kind.includes("off");
  // SVG не переносить рядки: довгий підпис («Мікроінвертор» у вужчій картці) стискаємо до вільної ширини
  const room = bw - 39, sm = label.length > 9;
  const squeeze = label.length * (sm ? 5 : 6.2) > room ? room : undefined;
  return <g class={`fc fn-${kind}${idle ? " dim" : ""}`}>
    <rect class="fc-box" x={x} y={y} width={bw} height={CD.h} rx="12" />
    <rect class="fc-edge" x={x} y={y + 12} width="3" height={CD.h - 24} rx="1.5" />
    <Icon kind={kind} soc={soc} cls="ico fc-ico" x={x + 12} y={y + 11} size={15} />
    <text class={`fc-l${sm ? " sm" : ""}`} x={x + 33} y={y + 23} textLength={squeeze} lengthAdjust="spacingAndGlyphs">{label}</text>
    <text class="fc-v" x={x + 12} y={y + 50}>{off ? "—" : fmtW(w)}</text>
    {note && <text class="fc-n" x={x + bw - 11} y={y + 50} text-anchor="end">{note}</text>}
  </g>;
}

/* ---------- gauge: кільце — звідки береться споживання ---------- */
function Gauge({ f, gl }: SkinProps) {
  const s = loadSources(f);
  const r = 78, circ = 2 * Math.PI * r, gap = 3;
  const parts = ([["pv", s.pv], ["gen", s.gen], ["bat", s.bat], ["grid", s.grid]] as const).filter(([, v]) => v > 0.005);
  let acc = 0;
  const dBat = dir(f.bat), exporting = !f.outage && f.grid !== null && f.grid < -DEAD;
  const solar = s.pv + s.gen;
  return <div class="gauge">
    <svg class="gauge-ring" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
      <circle cx="100" cy="100" r={r} class="gr-track" />
      {parts.map(([k, v]) => {
        const len = Math.max(0, v * circ - (parts.length > 1 ? gap : 0)), off = acc * circ; acc += v;
        return <g key={k} class={`gr gr-${k}`}>
          <circle cx="100" cy="100" r={r} class="gr-glow" transform="rotate(-90 100 100)" style={{ strokeDasharray: `${len} ${circ}`, strokeDashoffset: `${-off}` }} />
          <circle cx="100" cy="100" r={r} class="gr-arc" transform="rotate(-90 100 100)" style={{ strokeDasharray: `${len} ${circ}`, strokeDashoffset: `${-off}` }} />
        </g>;
      })}
      <text class="gr-l" x="100" y="78" text-anchor="middle">Споживання</text>
      <text class="gr-v" x="100" y="112" text-anchor="middle">{fmtW(f.load)}</text>
      {s.load > 0 && <text class="gr-s" x="100" y="134" text-anchor="middle">{solar >= 0.005 ? `${Math.round(solar * 100)}% від сонця` : s.bat >= s.grid ? "від батареї" : "з мережі"}</text>}
    </svg>
    <div class={`gauge-chips${f.gen !== null ? " chips-4" : ""}`}>
      <Chip kind="pv" label="Сонце" value={fmtW(f.pv)} dim={dir(f.pv) === 0} />
      {f.gen !== null && <Chip kind="gen" label={gl} value={fmtW(f.gen)} dim={dir(f.gen) === 0} />}
      <Chip kind={`bat${f.soc !== null && f.soc <= 30 ? " low" : ""}`} soc={f.soc} label={dBat === 0 ? "Батарея" : dBat > 0 ? "Розряд" : "Заряд"} value={f.soc === null ? "—" : `${f.soc}%`} sub={dBat === 0 ? "" : fmtW(Math.abs(f.bat!))} />
      <Chip kind={f.outage ? "grid off" : "grid"} label={f.outage ? "Мережі немає" : exporting ? "У мережу" : "Мережа"} value={f.outage ? "—" : fmtW(f.grid === null ? null : Math.abs(f.grid))} dim={!f.outage && dir(f.grid) === 0} />
    </div>
  </div>;
}
function Chip({ kind, soc, label, value, sub, dim }: { kind: string; soc?: number | null; label: string; value: string; sub?: string; dim?: boolean }) {
  return <div class={`gc gc-${kind}${dim ? " dim" : ""}`}>
    <span class="gc-i"><Icon kind={kind} soc={soc} cls="ico" /></span>
    <span class="gc-t"><small>{label}</small><b>{value}</b>{sub ? <i>{sub}</i> : null}</span>
  </div>;
}

/* ---------- sankey: стрічки джерело → споживач, товщина = потужність ---------- */
const SRC_LABEL: Record<SourceKind, string> = { pv: "Сонце", gen: GEN_LABEL, bat: "З батареї", grid: "З мережі" };
const SINK_LABEL: Record<SinkKind, string> = { load: "Споживання", charge: "Заряд батареї", export: "У мережу" };
const SINK_COLOR: Record<SinkKind, string> = { load: "load", charge: "bat", export: "grid" };
const SK = { w: 520, h: 160, x0: 165, x1: 349, bar: 6, slot: 42, pad: 5 };   // пропорція 3.25:1 під широку низьку картку (≈38×30 % екрана)

/** Розкладка колонки: кожен сегмент має слот не менший за SK.slot (щоб підписи не злипались), смуга по центру слота. */
function layout<K extends string>(items: { kind: K; w: number }[], scale: number) {
  const slots = items.map((it) => Math.max(it.w * scale, SK.slot));
  const total = slots.reduce((a, b) => a + b, 0);
  let y = (SK.h - total) / 2;
  return items.map((it, i) => { const t = Math.max(3, it.w * scale), top = y + (slots[i]! - t) / 2; y += slots[i]!; return { ...it, t, top, mid: top + t / 2 }; });
}
function Sankey({ f, gl }: SkinProps) {
  const g = flowGraph(f);
  if (!g.sources.length || !g.sinks.length) return <div class="sankey-empty">Немає потоку</div>;
  const srcLabel = (k: SourceKind) => (k === "gen" ? gl : SRC_LABEL[k]);
  const total = Math.max(g.sources.reduce((a, s) => a + s.w, 0), g.sinks.reduce((a, s) => a + s.w, 0));
  let scale = (SK.h - 2 * SK.pad) / total;
  for (let i = 0; i < 8; i++) {   // зменшуємо масштаб, доки слоти обох колонок не влізуть по висоті
    const need = Math.max(...[g.sources, g.sinks].map((col) => col.reduce((a, s) => a + Math.max(s.w * scale, SK.slot), 0)));
    if (need <= SK.h - 2 * SK.pad) break; scale *= 0.82;
  }
  const L = layout(g.sources, scale), Rr = layout(g.sinks, scale);
  const offL: Record<string, number> = {}, offR: Record<string, number> = {};
  const xm = (SK.x0 + SK.x1) / 2;
  return <svg class="sankey" viewBox={`0 0 ${SK.w} ${SK.h}`} preserveAspectRatio="xMidYMid meet">
    {g.links.map((l) => {
      const a = L.find((s) => s.kind === l.from)!, b = Rr.find((s) => s.kind === l.to)!;
      const t = Math.max(2, l.w * scale), tb = t;
      const y0 = a.top + (offL[l.from] ?? 0), y1 = b.top + (offR[l.to] ?? 0);
      offL[l.from] = (offL[l.from] ?? 0) + t; offR[l.to] = (offR[l.to] ?? 0) + t;
      const band = `M${SK.x0 + SK.bar},${y0} C${xm},${y0} ${xm},${y1} ${SK.x1},${y1} L${SK.x1},${y1 + tb} C${xm},${y1 + tb} ${xm},${y0 + t} ${SK.x0 + SK.bar},${y0 + t} Z`;
      const mid = `M${SK.x0 + SK.bar},${y0 + t / 2} C${xm},${y0 + t / 2} ${xm},${y1 + tb / 2} ${SK.x1},${y1 + tb / 2}`;
      return <g key={`${l.from}-${l.to}`} class={`sk-link sk-${l.from}`}>
        <path class="sk-band" d={band} />
        <path class={`sk-dash sk-to-${SINK_COLOR[l.to]}`} d={mid} style={{ animationDuration: speed(l.w) }} />
      </g>;
    })}
    {L.map((s) => <g key={s.kind} class={`sk-node sk-c-${s.kind}`}>
      <rect x={SK.x0} y={s.top} width={SK.bar} height={s.t} rx="3" />
      <text class="sk-v" x={SK.x0 - 10} y={s.mid + 2} text-anchor="end">{fmtW(s.w)}</text>
      <text class={`sk-l${srcLabel(s.kind).length > 10 ? " sm" : ""}`} x={SK.x0 - 10} y={s.mid + 16} text-anchor="end">{srcLabel(s.kind)}</text>
    </g>)}
    {Rr.map((s) => <g key={s.kind} class={`sk-node sk-c-${SINK_COLOR[s.kind]}`}>
      <rect x={SK.x1} y={s.top} width={SK.bar} height={s.t} rx="3" />
      <text class="sk-v" x={SK.x1 + SK.bar + 10} y={s.mid + 2}>{fmtW(s.w)}</text>
      <text class="sk-l" x={SK.x1 + SK.bar + 10} y={s.mid + 16}>{SINK_LABEL[s.kind]}{s.kind === "charge" && f.soc !== null ? ` · ${f.soc}%` : ""}</text>
    </g>)}
    <g class="sk-inv" transform={`translate(${xm},${SK.h / 2})`}><rect x="-17" y="-17" width="34" height="34" rx="9" /><InverterIcon x={-10} y={-10} width={20} height={20} class="ico" /></g>
  </svg>;
}

/* ---------- strip: компактний рядок ---------- */
function Strip({ f, gl }: SkinProps) {
  const dGrid = f.outage ? 0 : dir(f.grid), dBat = dir(f.bat), dPv = dir(f.pv), dGen = dir(f.gen);
  const arrow = (d: -1 | 0 | 1, w: number | null) => <span class={`fs-a${d === 0 ? " idle" : d > 0 ? " in" : " out"}`} style={{ animationDuration: speed(w) }}>{d === 0 ? "·" : d > 0 ? "▶" : "◀"}</span>;
  return <div class={`strip${f.gen !== null ? " strip-5" : ""}`}>
    <Cell kind="pv" label="Сонце" value={fmtW(f.pv)} dim={dPv === 0} />
    {arrow(dPv, f.pv)}
    {f.gen !== null && <Cell kind="gen" label={gl} value={fmtW(f.gen)} dim={dGen === 0} />}
    {f.gen !== null && arrow(dGen, f.gen)}
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
function Bars({ f, gl }: SkinProps) {
  const load = Math.max(f.load ?? 0, DEAD);
  const pct = (w: number | null) => Math.min(100, Math.round((Math.max(0, w ?? 0) / load) * 100));
  const rows: { kind: string; label: string; w: number | null; note: string }[] = [
    { kind: "pv", label: "Сонце", w: f.pv, note: "" },
    ...(f.gen !== null ? [{ kind: "gen", label: gl, w: f.gen, note: "" }] : []),
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
