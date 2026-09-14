/**
 * Повітряні тривоги по областях. Джерело за замовчуванням — публічне дзеркало
 * ubilling.net.ua (без ключа, оновлюється кожні ~15 с). Формат:
 *   { states: { "Київська область": { alertnow: true, changed: "2026-09-13 09:40:45" } } }
 * Час у джерелі київський; "1970-01-01 ..." означає, що початок невідомий.
 */
export const ALERTS_URL = "https://ubilling.net.ua/aerialalerts/?json=true";
export const ALERTS_REFRESH_MS = 20_000;
export const ALERTS_TTL_S = 180;

export interface AlertsSnapshot { updatedAt: string; source?: "ubilling" | "ukrainealarm"; oblasts: Record<string, { active: boolean; since: string | null }> }

/**
 * Офіційне джерело: api.ukrainealarm.com (ключ у заголовку Authorization).
 *   GET /api/v3/alerts/status -> { lastActionIndex }        (опитуємо кожні 15 с)
 *   GET /api/v3/alerts        -> лише регіони з активними тривогами (читаємо при зміні індексу)
 * Область активна, якщо на рівні State є тривога типу AIR. Регіони без тривог у відповіді відсутні.
 */
export const UKRAINEALARM_API = "https://api.ukrainealarm.com";
export const UKRAINEALARM_STATUS_MS = 15_000;
interface UaRegion { regionId: string; regionType: string; regionName: string; lastUpdate?: string; activeAlerts?: { regionId: string; regionType: string; type: string; lastUpdate?: string }[] }

export function parseUkrainealarm(json: unknown, allOblasts: readonly string[], now = new Date()): AlertsSnapshot {
  if (!Array.isArray(json)) throw new Error("ukrainealarm: unexpected payload");
  const oblasts: AlertsSnapshot["oblasts"] = {};
  for (const name of allOblasts) oblasts[name] = { active: false, since: null };
  for (const r of json as UaRegion[]) {
    if (r.regionType !== "State" || !r.regionName) continue;
    const air = (r.activeAlerts ?? []).find((a) => a.type === "AIR" && a.regionType === "State");
    if (!air) continue;
    const since = air.lastUpdate ? new Date(air.lastUpdate).toISOString() : null;
    oblasts[r.regionName] = { active: true, since };
  }
  return { updatedAt: now.toISOString(), source: "ukrainealarm", oblasts };
}

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
  return { updatedAt: now.toISOString(), source: "ubilling", oblasts };
}

export function alertsChanged(a: AlertsSnapshot | null, b: AlertsSnapshot): boolean {
  if (!a) return true;
  for (const [k, v] of Object.entries(b.oblasts)) if (a.oblasts[k]?.active !== v.active) return true;
  return Object.keys(a.oblasts).length !== Object.keys(b.oblasts).length;
}

/** regionId рівня State з GET /api/v3/regions (2026-09-14) -> назва області, як у OBLASTS. */
export const UKRAINEALARM_REGIONS: Record<string, string> = {
  "3": "Хмельницька область", "4": "Вінницька область", "5": "Рівненська область", "8": "Волинська область", "9": "Дніпропетровська область",
  "10": "Житомирська область", "11": "Закарпатська область", "12": "Запорізька область", "13": "Івано-Франківська область", "14": "Київська область",
  "15": "Кіровоградська область", "16": "Луганська область", "17": "Миколаївська область", "18": "Одеська область", "19": "Полтавська область",
  "20": "Сумська область", "21": "Тернопільська область", "22": "Харківська область", "23": "Херсонська область", "24": "Черкаська область",
  "25": "Чернігівська область", "26": "Чернівецька область", "27": "Львівська область", "28": "Донецька область", "31": "м. Київ",
  "9999": "Автономна Республіка Крим", "1293": "м. Харків та Харківська територіальна громада", "564": "м. Запоріжжя та Запорізька територіальна громада",
};

export interface WebhookEvent { oblast: string; active: boolean; at: string | null }

/**
 * Подія вебхука ukrainealarm (приклад у swagger: { regionId, status: "Activate"|"Deactivate", alarmType: "AIR", createdAt }).
 * Парсер толерантний до варіантів назв полів. Повертає null для не-повітряних тривог і регіонів нижче області.
 */
export function parseWebhookEvent(body: unknown): WebhookEvent | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const regionId = String(b.regionId ?? b.RegionId ?? b.region_id ?? "");
  const oblast = UKRAINEALARM_REGIONS[regionId];
  if (!oblast) return null;
  const type = String(b.alarmType ?? b.type ?? b.AlarmType ?? "AIR").toUpperCase();
  if (type && type !== "AIR") return null;
  const st = b.status ?? b.Status ?? b.isActive ?? b.active;
  let active: boolean;
  if (typeof st === "boolean") active = st;
  else if (typeof st === "string") active = /^(activate|active|start|on|true|1)$/i.test(st);
  else return null;
  const raw = b.createdAt ?? b.CreatedAt ?? b.lastUpdate ?? b.time;
  const at = typeof raw === "string" && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  return { oblast, active, at };
}
