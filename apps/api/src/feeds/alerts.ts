/**
 * Повітряні тривоги по областях. Джерело за замовчуванням — публічне дзеркало
 * ubilling.net.ua (без ключа, оновлюється кожні ~15 с). Формат:
 *   { states: { "Київська область": { alertnow: true, changed: "2026-09-13 09:40:45" } } }
 * Час у джерелі київський; "1970-01-01 ..." означає, що початок невідомий.
 */
import { OBLASTS } from "@deye/shared";
import bundledRegions from "./ukrainealarm-regions.json" with { type: "json" };

export const ALERTS_URL = "https://ubilling.net.ua/aerialalerts/?json=true";
export const ALERTS_REFRESH_MS = 20_000;
export const ALERTS_TTL_S = 180;

/** Рівень загрози (з 2026 тривоги оголошують по районах: жовтий — дрони, червоний — ракети). */
export type AlertLevel = "red" | "yellow";
export interface OblastAlert { since: string | null; level: AlertLevel | null }
export interface OblastState {
  active: boolean;
  since: string | null;
  /** найвищий рівень серед активних тривог області */
  level?: AlertLevel | null;
  /** активні тривоги за regionId (область, район або громада), щоб відбій одного району не гасив інші */
  alerts?: Record<string, OblastAlert>;
}
export interface AlertsSnapshot { updatedAt: string; source?: "ubilling" | "ukrainealarm"; oblasts: Record<string, OblastState> }

/**
 * Офіційне джерело: api.ukrainealarm.com (ключ у заголовку Authorization).
 *   GET /api/v3/alerts        -> регіони з активними тривогами (State, District, Community — окремими записами;
 *                                у громаді може бути й тривога її району); рівень у activeAlertLevels
 *   GET /api/v3/regions       -> дерево State -> District -> Community (для мапи regionId -> область)
 *   POST /api/v3/webhook      -> події { regionId, status, alarmType, alertLevel, createdAt }
 * Область активна, якщо тривога типу AIR є на рівні області АБО в будь-якому її районі/громаді.
 */
export const UKRAINEALARM_API = "https://api.ukrainealarm.com";
export const UKRAINEALARM_STATUS_MS = 15_000;
interface UaAlert { regionId?: string | number; regionType?: string; type?: string; lastUpdate?: string; alertLevel?: string; activeAlertLevels?: { alertLevel?: string; createdAt?: string }[] }
interface UaRegion { regionId: string | number; regionType: string; regionName: string; lastUpdate?: string; activeAlerts?: UaAlert[] }

/** regionId -> області, яких стосується тривога цього регіону (район -> його область; громада-місто -> і вона, і область). */
export type RegionIndex = Map<string, string[]>;

export function parseLevel(v: unknown): AlertLevel | null {
  const s = String(v ?? "").toLowerCase();
  return s === "red" ? "red" : s === "yellow" ? "yellow" : null;
}
const maxLevel = (a: AlertLevel | null, b: AlertLevel | null): AlertLevel | null => (a === "red" || b === "red" ? "red" : a ?? b);

/** Стан області з мапи активних тривог: активна, якщо є хоч одна; since — найраніший початок. */
export function oblastFromAlerts(alerts: Record<string, OblastAlert>, prev?: OblastState, at?: string | null): OblastState {
  const list = Object.values(alerts);
  if (!list.length) return { active: false, since: prev?.active ? at ?? new Date().toISOString() : prev?.since ?? null, level: null, alerts: {} };
  let since: string | null = null, level: AlertLevel | null = null;
  for (const a of list) { if (a.since && (!since || a.since < since)) since = a.since; level = maxLevel(level, a.level); }
  return { active: true, since: prev?.active ? prev.since ?? since : since, level, alerts };
}

export function parseUkrainealarm(json: unknown, allOblasts: readonly string[], now = new Date(), index: RegionIndex = seedRegionIndex()): AlertsSnapshot {
  if (!Array.isArray(json)) throw new Error("ukrainealarm: unexpected payload");
  const acc: Record<string, Record<string, OblastAlert>> = {};
  for (const r of json as UaRegion[]) {
    const own = index.get(String(r.regionId)) ?? (r.regionType === "State" ? oblastNamesFor(r.regionName, allOblasts) : []);
    for (const a of r.activeAlerts ?? []) {
      if ((a.type ?? "AIR") !== "AIR") continue;
      const aid = String(a.regionId ?? r.regionId);
      const targets = new Set([...own, ...(index.get(aid) ?? [])]);
      let level = parseLevel(a.alertLevel);
      for (const l of a.activeAlertLevels ?? []) level = maxLevel(level, parseLevel(l?.alertLevel));
      for (const name of targets) (acc[name] ??= {})[aid] = { since: a.lastUpdate ? new Date(a.lastUpdate).toISOString() : null, level };
    }
  }
  const oblasts: AlertsSnapshot["oblasts"] = {};
  for (const name of allOblasts) oblasts[name] = { active: false, since: null, level: null, alerts: {} };
  for (const [name, alerts] of Object.entries(acc)) oblasts[name] = oblastFromAlerts(alerts);
  return { updatedAt: now.toISOString(), source: "ukrainealarm", oblasts };
}

/** Доповнює мапу регіонів із відповіді /alerts: тривоги, вкладені в State, належать цій області. */
export function learnRegions(json: unknown, index: RegionIndex, allOblasts: readonly string[]): number {
  if (!Array.isArray(json)) return 0;
  let added = 0;
  for (const r of json as UaRegion[]) {
    if (r.regionType !== "State") continue;
    const names = index.get(String(r.regionId)) ?? oblastNamesFor(r.regionName, allOblasts);
    if (!names.length) continue;
    for (const a of r.activeAlerts ?? []) {
      const aid = String(a.regionId ?? "");
      if (!aid || aid === String(r.regionId) || index.has(aid)) continue;
      index.set(aid, names); added++;
    }
  }
  return added;
}

/** Назва State з API -> запис(и) OBLASTS ("м. Севастополь" -> "Севастополь"). */
export function oblastNamesFor(regionName: string | undefined, allOblasts: readonly string[]): string[] {
  if (!regionName) return [];
  if (allOblasts.includes(regionName)) return [regionName];
  const bare = regionName.replace(/^м\.\s*/, "");
  const hit = allOblasts.find((o) => o === bare || o.replace(/^м\.\s*/, "") === bare);
  return hit ? [hit] : [];
}

/**
 * Мапа з дерева GET /api/v3/regions: { states: [{ regionId, regionName, regionType: "State", regionChildIds: [...] }] }.
 * Парсер толерантний до назви поля з дітьми. Район/громада -> своя область; громади-міста з OBLASTS — ще й самі по собі.
 */
export function buildRegionIndex(json: unknown, allOblasts: readonly string[], seed: RegionIndex = baseRegionIndex()): RegionIndex {
  const index: RegionIndex = new Map(seed);
  const walk = (node: unknown, ancestors: string[]) => {
    if (Array.isArray(node)) { for (const n of node) walk(n, ancestors); return; }
    if (!node || typeof node !== "object") return;
    const r = node as Record<string, unknown>;
    let next = ancestors;
    if (r.regionId !== undefined) {
      const id = String(r.regionId);
      const own = seed.get(id) ?? [];
      const asState = r.regionType === "State" ? oblastNamesFor(String(r.regionName ?? ""), allOblasts) : [];
      const names = [...new Set([...own, ...asState, ...ancestors])];
      if (names.length) index.set(id, names);
      next = [...new Set([...asState, ...(r.regionType === "State" ? own : []), ...ancestors])];
    }
    for (const key of ["regionChildIds", "children", "regions", "states", "districts", "communities"]) if (key in r) walk(r[key], next);
  };
  walk(json, []);
  return index;
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
/** Громади-міста з OBLASTS: тривога в них стосується і області. */
const CITY_COMMUNITY_PARENT: Record<string, string> = { "1293": "Харківська область", "564": "Запорізька область" };

/** Базова мапа: лише області та дві громади-міста (без дерева). */
export function baseRegionIndex(): RegionIndex {
  const m: RegionIndex = new Map();
  for (const [id, name] of Object.entries(UKRAINEALARM_REGIONS)) m.set(id, CITY_COMMUNITY_PARENT[id] ? [name, CITY_COMMUNITY_PARENT[id]] : [name]);
  return m;
}
let seedCache: RegionIndex | null = null;
/** Стартова мапа без мережі: вбудований дамп GET /api/v3/regions (2026-09-14). Свіжу версію хаб підтягує з API. */
export function seedRegionIndex(): RegionIndex {
  seedCache ??= buildRegionIndex(bundledRegions, OBLASTS, baseRegionIndex());
  return new Map(seedCache);
}

/** Мапа <-> JSON для кешу в Redis. */
export const regionIndexToJson = (index: RegionIndex): Record<string, string[]> => Object.fromEntries(index);
export const regionIndexFromJson = (json: unknown): RegionIndex | null => {
  if (!json || typeof json !== "object") return null;
  const m: RegionIndex = new Map();
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) if (Array.isArray(v) && v.every((x) => typeof x === "string")) m.set(k, v as string[]);
  return m.size ? m : null;
};

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

/** Зміна, про яку варто сповістити екрани: активність або рівень загрози. */
export function alertsChanged(a: AlertsSnapshot | null, b: AlertsSnapshot): boolean {
  if (!a) return true;
  for (const [k, v] of Object.entries(b.oblasts)) {
    const p = a.oblasts[k];
    if (p?.active !== v.active || (v.active && (p?.level ?? null) !== (v.level ?? null))) return true;
  }
  return Object.keys(a.oblasts).length !== Object.keys(b.oblasts).length;
}

export interface WebhookEvent { regionId: string; oblasts: string[]; active: boolean; at: string | null; level: AlertLevel | null }

/**
 * Подія вебхука ukrainealarm: { regionId, status: "Activate"|"DEACTIVATE", alarmType: "AIR", alertLevel: "Red"|"Yellow",
 * createdAt, activeAlertLevels: [...] }. regionId — область, район або громада; oblasts — кого це стосується (порожньо,
 * якщо регіон невідомий мапі). Повертає null для не-повітряних тривог і тіл без статусу.
 */
export function parseWebhookEvent(body: unknown, index: RegionIndex = seedRegionIndex()): WebhookEvent | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const regionId = String(b.regionId ?? b.RegionId ?? b.region_id ?? "");
  if (!regionId) return null;
  const type = String(b.alarmType ?? b.type ?? b.AlarmType ?? "AIR").toUpperCase();
  if (type && type !== "AIR") return null;
  const st = b.status ?? b.Status ?? b.isActive ?? b.active;
  let active: boolean;
  if (typeof st === "boolean") active = st;
  else if (typeof st === "string") active = /^(activate|active|start|on|true|1)$/i.test(st);
  else return null;
  const raw = b.createdAt ?? b.CreatedAt ?? b.lastUpdate ?? b.time;
  const at = typeof raw === "string" && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  let level = parseLevel(b.alertLevel);
  if (Array.isArray(b.activeAlertLevels)) for (const l of b.activeAlertLevels as { alertLevel?: unknown }[]) level = maxLevel(level, parseLevel(l?.alertLevel));
  return { regionId, oblasts: index.get(regionId) ?? [], active, at, level };
}
