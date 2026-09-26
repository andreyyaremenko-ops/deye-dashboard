/**
 * Математика віджета «Потік енергії»: звідки береться споживання і як розкласти потоки джерело → споживач.
 * Знаки як у телеметрії: bat > 0 розряд, < 0 заряд; grid > 0 з мережі, < 0 у мережу; pv, gen і load ≥ 0.
 * gen — GEN-порт інвертора (мікроінвертор чи генератор): окреме AC-джерело, яке не проходить через CT мережі,
 * тому в балансі load = grid + gen + inv. null, якщо порт не задіяний.
 */
export interface FlowInput { pv: number | null; load: number | null; bat: number | null; grid: number | null; gen?: number | null }
export type SourceKind = "pv" | "gen" | "bat" | "grid";
export type SinkKind = "load" | "charge" | "export";
/** Джерела в порядку пріоритету: спершу безкоштовне сонце (панелі, далі мікроінвертор), потім батарея, потім мережа. */
export const SOURCE_ORDER = ["pv", "gen", "bat", "grid"] as const;
const SINK_ORDER = ["load", "charge", "export"] as const;

/** Вт: менше — «немає потоку» (шум вимірювань). */
export const FLOW_DEAD_W = 20;
const pos = (v: number | null | undefined) => (v !== null && v !== undefined && v > FLOW_DEAD_W ? v : 0);

/** Частки споживання за джерелами (сума 1, або всі 0, якщо споживання/джерел немає). Порядок пріоритету — SOURCE_ORDER. */
export function loadSources(f: FlowInput): { load: number } & Record<SourceKind, number> {
  const load = pos(f.load);
  const zero = { load: 0, pv: 0, gen: 0, bat: 0, grid: 0 };
  if (!load) return zero;
  const src: Record<SourceKind, number> = { pv: pos(f.pv), gen: pos(f.gen), bat: pos(f.bat), grid: pos(f.grid) };
  const got: Record<SourceKind, number> = { pv: 0, gen: 0, bat: 0, grid: 0 };
  let left = load;
  for (const k of SOURCE_ORDER) { got[k] = Math.min(src[k], left); left -= got[k]; }
  const sum = SOURCE_ORDER.reduce((a, k) => a + got[k], 0);
  if (!sum) return { ...zero, load };
  return { load, pv: got.pv / sum, gen: got.gen / sum, bat: got.bat / sum, grid: got.grid / sum };   // нормалізація ховає втрати інвертора і похибку датчиків
}

export interface FlowLink { from: SourceKind; to: SinkKind; w: number }
export interface FlowGraph { sources: { kind: SourceKind; w: number }[]; sinks: { kind: SinkKind; w: number }[]; links: FlowLink[] }

/**
 * Розкладка для Sankey: жадібно, у порядку пріоритету. Споживання живиться сонцем, потім батареєю, потім мережею;
 * заряд батареї і віддача в мережу — з того, що лишилось. Нерозподілений залишок (втрати) відкидається.
 */
export function flowGraph(f: FlowInput): FlowGraph {
  const src: Record<SourceKind, number> = { pv: pos(f.pv), gen: pos(f.gen), bat: pos(f.bat), grid: pos(f.grid) };
  const snk: Record<SinkKind, number> = { load: pos(f.load), charge: pos(f.bat === null ? null : -f.bat), export: pos(f.grid === null ? null : -f.grid) };
  const sources = SOURCE_ORDER.filter((k) => src[k] > 0).map((kind) => ({ kind, w: src[kind] }));
  const sinks = SINK_ORDER.filter((k) => snk[k] > 0).map((kind) => ({ kind, w: snk[kind] }));
  const left = { ...src }, links: FlowLink[] = [];
  for (const to of SINK_ORDER) {
    let need = snk[to];
    for (const from of SOURCE_ORDER) {
      const w = Math.min(left[from], need);
      if (w > FLOW_DEAD_W / 2) { links.push({ from, to, w }); left[from] -= w; need -= w; }
    }
  }
  return { sources, sinks, links };
}
