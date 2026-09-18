/**
 * Математика віджета «Потік енергії»: звідки береться споживання і як розкласти потоки джерело → споживач.
 * Знаки як у телеметрії: bat > 0 розряд, < 0 заряд; grid > 0 з мережі, < 0 у мережу; pv і load ≥ 0.
 */
export interface FlowInput { pv: number | null; load: number | null; bat: number | null; grid: number | null }
export type SourceKind = "pv" | "bat" | "grid";
export type SinkKind = "load" | "charge" | "export";

/** Вт: менше — «немає потоку» (шум вимірювань). */
export const FLOW_DEAD_W = 20;
const pos = (v: number | null) => (v !== null && v > FLOW_DEAD_W ? v : 0);

/** Частки споживання за джерелами (сума 1, або всі 0, якщо споживання/джерел немає). Сонце має пріоритет, далі батарея, решта — мережа. */
export function loadSources(f: FlowInput): { load: number; pv: number; bat: number; grid: number } {
  const load = pos(f.load);
  if (!load) return { load: 0, pv: 0, bat: 0, grid: 0 };
  const pv = Math.min(pos(f.pv), load);
  const bat = Math.min(pos(f.bat), load - pv);
  const grid = Math.min(pos(f.grid), load - pv - bat);
  const sum = pv + bat + grid;
  if (!sum) return { load, pv: 0, bat: 0, grid: 0 };
  return { load, pv: pv / sum, bat: bat / sum, grid: grid / sum };   // нормалізація ховає втрати інвертора і похибку датчиків
}

export interface FlowLink { from: SourceKind; to: SinkKind; w: number }
export interface FlowGraph { sources: { kind: SourceKind; w: number }[]; sinks: { kind: SinkKind; w: number }[]; links: FlowLink[] }

/**
 * Розкладка для Sankey: жадібно, у порядку пріоритету. Споживання живиться сонцем, потім батареєю, потім мережею;
 * заряд батареї і віддача в мережу — з того, що лишилось. Нерозподілений залишок (втрати) відкидається.
 */
export function flowGraph(f: FlowInput): FlowGraph {
  const src: Record<SourceKind, number> = { pv: pos(f.pv), bat: pos(f.bat), grid: pos(f.grid) };
  const snk: Record<SinkKind, number> = { load: pos(f.load), charge: pos(f.bat === null ? null : -f.bat), export: pos(f.grid === null ? null : -f.grid) };
  const sources = (["pv", "bat", "grid"] as const).filter((k) => src[k] > 0).map((kind) => ({ kind, w: src[kind] }));
  const sinks = (["load", "charge", "export"] as const).filter((k) => snk[k] > 0).map((kind) => ({ kind, w: snk[kind] }));
  const left = { ...src }, links: FlowLink[] = [];
  for (const to of ["load", "charge", "export"] as const) {
    let need = snk[to];
    for (const from of ["pv", "bat", "grid"] as const) {
      const w = Math.min(left[from], need);
      if (w > FLOW_DEAD_W / 2) { links.push({ from, to, w }); left[from] -= w; need -= w; }
    }
  }
  return { sources, sinks, links };
}
