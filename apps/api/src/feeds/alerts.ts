/**
 * Повітряні тривоги по областях. Джерело за замовчуванням — публічне дзеркало
 * ubilling.net.ua (без ключа, оновлюється кожні ~15 с). Формат:
 *   { states: { "Київська область": { alertnow: true, changed: "2026-09-13 09:40:45" } } }
 * Час у джерелі київський; "1970-01-01 ..." означає, що початок невідомий.
 */
export const ALERTS_URL = "https://ubilling.net.ua/aerialalerts/?json=true";
export const ALERTS_REFRESH_MS = 20_000;
export const ALERTS_TTL_S = 180;

export interface AlertsSnapshot { updatedAt: string; oblasts: Record<string, { active: boolean; since: string | null }> }

/** "YYYY-MM-DD HH:MM:SS" у Києві -> ISO (враховує літній/зимовий час). */
export function kyivToIso(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m || m[1] === "1970") return null;
  for (const off of ["+03:00", "+02:00"]) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`);
    const local = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
    if (local === s) return d.toISOString();
  }
  return null;
}

export function parseAlerts(json: unknown, now = new Date()): AlertsSnapshot {
  const d = json as { states?: Record<string, { alertnow?: boolean; changed?: string }> };
  if (!d?.states || typeof d.states !== "object") throw new Error("alerts: unexpected payload");
  const oblasts: AlertsSnapshot["oblasts"] = {};
  for (const [name, v] of Object.entries(d.states)) {
    oblasts[name] = { active: !!v.alertnow, since: v.changed ? kyivToIso(v.changed) : null };
  }
  if (!Object.keys(oblasts).length) throw new Error("alerts: empty");
  return { updatedAt: now.toISOString(), oblasts };
}

export function alertsChanged(a: AlertsSnapshot | null, b: AlertsSnapshot): boolean {
  if (!a) return true;
  for (const [k, v] of Object.entries(b.oblasts)) if (a.oblasts[k]?.active !== v.active) return true;
  return Object.keys(a.oblasts).length !== Object.keys(b.oblasts).length;
}
