/**
 * Полотно 16:9. Віджети в % екрана; перетягування і зміна розміру мишею/пальцем.
 * Координати округлюються до 0.5%, мінімальний розмір 8×6%.
 */
import { useRef, useState, type PointerEvent } from "react";
import { menuStyle } from "@deye/shared/menu";
import { labelOf, type Widget as W } from "./widgetTypes.ts";

export function Canvas({ widgets, selected, onSelect, onChange, theme }:
  { widgets: W[]; selected: string | null; onSelect: (id: string | null) => void; onChange: (w: W) => void; theme: "dark" | "light" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; sx: number; sy: number; start: W } | null>(null);

  const pct = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  };
  const snap = (v: number) => Math.round(v * 2) / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const down = (e: PointerEvent, w: W, mode: "move" | "resize") => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pct(e); onSelect(w.id); setDrag({ id: w.id, mode, sx: p.x, sy: p.y, start: { ...w } });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const p = pct(e); const dx = p.x - drag.sx, dy = p.y - drag.sy; const s = drag.start;
    if (drag.mode === "move") onChange({ ...s, x: snap(clamp(s.x + dx, 0, 100 - s.w)), y: snap(clamp(s.y + dy, 0, 100 - s.h)) });
    else onChange({ ...s, w: snap(clamp(s.w + dx, 8, 100 - s.x)), h: snap(clamp(s.h + dy, 6, 100 - s.y)) });
  };
  const up = () => setDrag(null);

  return <div ref={ref} className={`canvas theme-${theme}`} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={() => onSelect(null)}>
    {widgets.map((w) => <div key={w.id} className={`cw${selected === w.id ? " sel" : ""}`}
      style={{ left: `${w.x}%`, top: `${w.y}%`, width: `${w.w}%`, height: `${w.h}%` }}
      onPointerDown={(e) => down(e, w, "move")}>
      <div className="cw-t">{labelOf(w.type)}</div>
      {w.type === "text" ? <MenuPreview props={w.props ?? {}} theme={theme} /> : <Mock w={w} />}
      <div className="cw-r" onPointerDown={(e) => down(e, w, "resize")} />
    </div>)}
    {widgets.length === 0 && <div className="canvas-empty">Додайте віджети праворуч</div>}
  </div>;
}

/** Умовний вміст віджета на полотні, щоб розкладку було видно без ТБ. */
const MOCK: Partial<Record<W["type"], (p: Record<string, unknown>) => [string, string?]>> = {
  pv: () => ["4.2 kW", "сьогодні 18.4 kWh"], battery: () => ["64 %", "заряд 1.6 kW"], grid: () => ["0.5 kW", "з мережі · 50.0 Hz"], load: () => ["2.0 kW", "сьогодні 22.1 kWh"],
  energy_today: () => ["18.4 kWh", "сонце · спожито 22.1"], runtime: () => ["≈ 6 год", "якщо зникне світло"], clock: () => [new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }), "сьогодні"],
  chart: () => ["▁▂▃▅▇█▇▅▃▂▁", "потужність за добу"], weather: () => ["+21°", "сонячно · завтра 17 kWh"], alert: () => ["Тривоги немає", "область зі списку"], eco: () => ["−120 кг CO₂", "цього місяця"],
  outage: (p) => [p.hideWhenOk === false ? "Світло є" : "Банер при відключенні"], flow: (p) => [p.skin === "strip" ? "☀ → ⌂ → ▭" : "☀ ⌂ ▭ ⚡", "потік енергії"],
  qr: (p) => ["▦ QR", String(p.caption ?? "")],
};
function Mock({ w }: { w: W }) {
  const m = MOCK[w.type]?.(w.props ?? {});
  if (!m) return null;
  return <><div className="cw-big">{m[0]}</div>{m[1] && <div className="cw-sub">{m[1]}</div>}</>;
}

/** Перші рядки меню у вибраному шрифті й кольорах (масштаб полотна ≈ 1/3 екрана ТБ). */
function MenuPreview({ props, theme }: { props: Record<string, unknown>; theme: "dark" | "light" }) {
  const st = menuStyle(props, theme);
  const lines = String(props.text ?? "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 4);
  return <div className="cw-b cw-menu" style={{ fontFamily: st.fontFamily, color: st.color ?? undefined, fontSize: `${st.fontSize * 0.45}rem` }}>
    {props.title ? <b style={{ color: st.accent ?? undefined }}>{String(props.title)}</b> : null}
    {lines.map((l, i) => <div key={i}>{l.replace(/^#\s*/, "")}</div>)}
  </div>;
}
