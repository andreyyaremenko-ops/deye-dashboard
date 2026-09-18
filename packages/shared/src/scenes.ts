/**
 * Ротація сцен на одному телевізорі: розклад за годинами, пріоритет сцени при відключенні світла, наступна сцена.
 * Функції чисті й узагальнені (SceneLike), щоб не залежати від zod-схеми екрана.
 */
export interface SceneSchedule { from: string; to: string }   // "HH:MM", локальний час телевізора
export interface SceneLike { id: string; durationS: number; schedule: SceneSchedule | null; onOutage: boolean }
export type RotationMode = "sequence" | "random";
export const MAX_SCENES = 10;

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/** Чи активний розклад у цю хвилину доби. Інтервал може переходити через північ (22:00–02:00); from == to — цілодобово. */
export function inSchedule(s: SceneSchedule | null, minuteOfDay: number): boolean {
  if (!s) return true;
  const a = minutes(s.from), b = minutes(s.to);
  if (a === b) return true;
  return a < b ? minuteOfDay >= a && minuteOfDay < b : minuteOfDay >= a || minuteOfDay < b;
}

/**
 * Сцени, які можна показувати зараз. При відключенні світла — лише позначені onOutage (якщо такі є).
 * Якщо розклад відсіяв усе, лишається перша сцена: екран ніколи не порожній.
 */
export function eligibleScenes<T extends SceneLike>(scenes: T[], now: Date, outage: boolean): T[] {
  if (!scenes.length) return [];
  if (outage) { const pinned = scenes.filter((s) => s.onOutage); if (pinned.length) return pinned; }
  const m = now.getHours() * 60 + now.getMinutes();
  const ok = scenes.filter((s) => inSchedule(s.schedule, m));
  return ok.length ? ok : [scenes[0]!];
}

/** Наступна сцена: по колу або випадково (без повтору тієї самої двічі поспіль, якщо є вибір). */
export function nextScene<T extends SceneLike>(eligible: T[], currentId: string | null, mode: RotationMode, rnd: () => number = Math.random): T | null {
  if (!eligible.length) return null;
  const i = eligible.findIndex((s) => s.id === currentId);
  if (mode === "random") {
    const pool = eligible.length > 1 ? eligible.filter((s) => s.id !== currentId) : eligible;
    return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))]!;
  }
  return eligible[(i + 1) % eligible.length]!;   // i = -1 (поточної немає серед дозволених) -> перша
}
