/**
 * Полотно 16:9. Віджети в % екрана; перетягування і зміна розміру мишею/пальцем.
 * Координати округлюються до 0.5%, мінімальний розмір 8×6%.
 */
import { useRef, useState, type PointerEvent } from "react";
import type { ScreenConfig } from "@deye/shared";

type W = ScreenConfig["widgets"][number];
const LABEL: Record<string, string> = { pv: "Сонце", battery: "Батарея", grid: "Мережа", load: "Споживання", energy_today: "Сьогодні", clock: "Годинник", text: "Меню", chart: "Графік доби", qr: "QR-код", runtime: "Автономія", weather: "Погода", alert: "Тривога", eco: "Еко-статистика", outage: "Банер відключення" };

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
      <div className="cw-t">{LABEL[w.type] ?? w.type}</div>
      {w.type === "text" && <div className="cw-b">{String(w.props?.title ?? "")}{w.props?.title ? ": " : ""}{String(w.props?.text ?? "").split(/\r?\n/).slice(0, 3).join(" · ")}</div>}
      <div className="cw-r" onPointerDown={(e) => down(e, w, "resize")} />
    </div>)}
    {widgets.length === 0 && <div className="canvas-empty">Додайте віджети праворуч</div>}
  </div>;
}
