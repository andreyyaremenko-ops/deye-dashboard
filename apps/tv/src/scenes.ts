/** Активна сцена екрана: таймер показу, розклад за годинами, пріоритет сцени при відключенні світла. Логіка вибору — у @deye/shared/scenes. */
import { useEffect, useRef, useState } from "preact/hooks";
import type { Scene, ScreenConfig } from "@deye/shared";
import { eligibleScenes, nextScene } from "@deye/shared/scenes";

/** Сцени конфігу; у відповіді старого API їх може не бути — тоді одна сцена з полів верхнього рівня. */
export function scenesOf(cfg: ScreenConfig | undefined | null): Scene[] {
  if (!cfg) return [];
  if (cfg.scenes?.length) return cfg.scenes;
  return [{ id: "main", name: "", durationS: 30, backgroundId: cfg.backgroundId, theme: cfg.theme, widgets: cfg.widgets, schedule: null, onOutage: false }];
}

/**
 * Раз на секунду: якщо поточна сцена вже не дозволена (розклад, відключення світла) — перемикаємо одразу;
 * інакше після durationS — на наступну. Одна дозволена сцена -> просто стоїть.
 */
export function useActiveScene(cfg: ScreenConfig | undefined | null, outage: boolean): Scene | null {
  const scenes = scenesOf(cfg);
  const [id, setId] = useState<string | null>(null);
  const ref = useRef({ scenes, outage, mode: cfg?.rotation ?? "sequence", id, since: Date.now() });
  ref.current.scenes = scenes; ref.current.outage = outage; ref.current.mode = cfg?.rotation ?? "sequence";

  useEffect(() => {
    const tick = () => {
      const r = ref.current;
      const el = eligibleScenes(r.scenes, new Date(), r.outage);
      if (!el.length) return;
      const cur = el.find((s) => s.id === r.id);
      const due = cur && el.length > 1 && Date.now() - r.since >= cur.durationS * 1000;
      if (cur && !due) return;
      // поточна зникла з дозволених: при відключенні показуємо першу з пріоритетних, інакше — наступну по колу
      const nxt = cur ? nextScene(el, r.id, r.mode) : el[0]!;
      if (nxt && nxt.id !== r.id) { r.id = nxt.id; r.since = Date.now(); setId(nxt.id); }
      else if (nxt) r.since = Date.now();
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  return scenes.find((s) => s.id === id) ?? scenes[0] ?? null;
}
