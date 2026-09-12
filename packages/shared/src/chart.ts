/** Чисті функції для SVG-графіків (без залежностей від React/Preact). */

export interface XY { x: number; y: number | null }

/** Ламана по точках у пікселях; null розриває лінію. */
export function linePath(points: XY[]): string {
  let d = ""; let pen = false;
  for (const p of points) {
    if (p.y === null || Number.isNaN(p.y)) { pen = false; continue; }
    d += (pen ? " L" : " M") + p.x.toFixed(1) + " " + p.y.toFixed(1);
    pen = true;
  }
  return d.trim();
}

/** Замкнута область під лінією до baseline (для заливки). */
export function areaPath(points: XY[], baseY: number): string {
  const segs: XY[][] = []; let cur: XY[] = [];
  for (const p of points) { if (p.y === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(p); }
  if (cur.length) segs.push(cur);
  return segs.map((s) => `M${s[0]!.x.toFixed(1)} ${baseY.toFixed(1)} ` + s.map((p) => `L${p.x.toFixed(1)} ${(p.y as number).toFixed(1)}`).join(" ") + ` L${s[s.length - 1]!.x.toFixed(1)} ${baseY.toFixed(1)} Z`).join(" ");
}

/** "Красиві" поділки осі: 0..max з кроком 1/2/5×10^n, 3–6 поділок. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain, [r0, r1] = range; const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

export const fmtPower = (w: number) => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(w % 1000 === 0 ? 0 : 1)} kW` : `${Math.round(w)} W`);
export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
