/** Лінійні іконки для віджетів (viewBox 24×24, stroke currentColor). Без емодзі: на ТБ вони різні або відсутні. */
import type { JSX } from "preact";

type P = JSX.SVGAttributes<SVGSVGElement> & { soc?: number | null };
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;

export const SunIcon = (p: P) => <svg {...base} {...p}>
  <circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity=".25" />
  <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
</svg>;
export const HouseIcon = (p: P) => <svg {...base} {...p}>
  <path d="M3 11.5 12 4l9 7.5" />
  <path d="M5 10.5V20h14v-9.5" />
  <path d="M10 20v-6h4v6" fill="currentColor" fill-opacity=".25" />
</svg>;
export const BoltIcon = (p: P) => <svg {...base} {...p}>
  <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H13z" fill="currentColor" fill-opacity=".25" />
</svg>;
/** Батарея з рівнем заряду (soc 0…100). */
export const BatteryIcon = ({ soc, ...p }: P) => {
  const lvl = soc === null || soc === undefined ? 0 : Math.max(0, Math.min(100, soc));
  return <svg {...base} {...p}>
    <rect x="2.5" y="7" width="17" height="10" rx="2" />
    <path d="M21.5 10.5v3" stroke-width="2.5" />
    <rect x="4.5" y="9" width={13 * lvl / 100} height="6" rx=".8" fill="currentColor" stroke="none" />
  </svg>;
};
export const InverterIcon = (p: P) => <svg {...base} {...p}>
  <rect x="3" y="5" width="18" height="14" rx="2.5" />
  <path d="M6.5 12c1.5-3.5 3-3.5 4.5 0s3 3.5 4.5 0" />
  <path d="M17.5 8.5h1M17.5 15.5h1" />
</svg>;
export const GridOffIcon = (p: P) => <svg {...base} {...p}>
  <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H13z" fill="currentColor" fill-opacity=".2" />
  <path d="M3 3l18 18" stroke-width="2.5" />
</svg>;
/** Мікроінвертор (GEN-порт): панель + синусоїда AC — джерело змінного струму поряд з інвертором. */
export const MicroInverterIcon = (p: P) => <svg {...base} {...p}>
  <rect x="2.5" y="3.5" width="19" height="10" rx="1.5" fill="currentColor" fill-opacity=".18" />
  <path d="M12 3.5v10M2.5 8.5h19" stroke-width="1.2" />
  <path d="M4 19c1.3-3 2.7-3 4 0s2.7 3 4 0 2.7-3 4 0" />
</svg>;
