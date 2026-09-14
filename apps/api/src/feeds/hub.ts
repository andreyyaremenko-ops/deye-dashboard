/**
 * Опитує зовнішні джерела, кладе в StateStore і сповіщає WS-клієнтів за ключем:
 *   "alerts"            — усі області (екран бере свою)
 *   "weather:<lat,lon>" — точка погоди
 * Локації беруться з конфігів екранів; нова локація підтягується на вимогу.
 */
import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { AlertFeed, ScreenLocation, WeatherFeed } from "@deye/shared";
import type { StateStore } from "../state/store.ts";
import { ALERTS_REFRESH_MS, ALERTS_TTL_S, ALERTS_URL, UKRAINEALARM_API, UKRAINEALARM_STATUS_MS, alertsChanged, buildRegionIndex, learnRegions, oblastFromAlerts, parseAlerts, parseUkrainealarm, regionIndexFromJson, regionIndexToJson, baseRegionIndex, seedRegionIndex, type AlertsSnapshot, type OblastAlert, type OblastState, type RegionIndex, type WebhookEvent } from "./alerts.ts";
import { OBLASTS } from "@deye/shared";
import { createHash } from "node:crypto";

/** Секрет у шляху вебхука виводиться з ключа API: нового env не потрібно. */
export function webhookSecret(apiKey: string): string { return createHash("sha256").update("ukrainealarm-webhook:" + apiKey).digest("hex").slice(0, 32); }
export function webhookUrlFor(publicUrl: string, apiKey: string): string { return `${publicUrl.replace(/\/$/, "")}/api/webhooks/ukrainealarm/${webhookSecret(apiKey)}`; }
import { WEATHER_REFRESH_MS, WEATHER_TTL_S, parseWeather, weatherKey, weatherUrl } from "./weather.ts";

type Db = PgDatabase<any, any, any>;
interface Log { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void }

export interface FeedHubOpts {
  db: Db; store: StateStore; log: Log;
  fetchImpl?: typeof fetch;
  alertsUrl?: string | null;       // null -> тривоги вимкнено
  /** ключ api.ukrainealarm.com: якщо є — офіційне джерело, дзеркало ubilling лише без ключа */
  alertsKey?: string | null;
  alertsApi?: string;
  /** публічна адреса вебхука для ukrainealarm (без неї — опитування статусу) */
  webhookUrl?: string | null;
  weatherBase?: string;
}

export interface ScreenFeeds { weather: WeatherFeed | null; alert: AlertFeed | null }

export class FeedHub {
  private timers: ReturnType<typeof setInterval>[] = [];
  private inflight = new Map<string, Promise<WeatherFeed | null>>();
  private lastAlerts: AlertsSnapshot | null = null;
  private lastActionIndex: unknown = null;
  /** regionId -> області; стартово вбудований дамп дерева, свіжа мапа з /regions (кеш у Redis на 7 днів) */
  private index: RegionIndex = seedRegionIndex();
  private regionsLoadedAt = 0;
  private regionsAttemptAt = 0;
  /** остання успішна повна синхронізація з офіційного джерела */
  private lastSyncOkAt = 0;
  static REGIONS_TTL_S = 7 * 86_400;
  static REGIONS_RETRY_MS = 15 * 60_000;
  /** /regions читаємо не одразу після старту: API віддає 401 на щільну серію запитів */
  static REGIONS_DELAY_MS = 5 * 60_000;
  /** у режимі вебхука кеш «живий», поки остання синхронізація не старша за це */
  static SYNC_FRESH_MS = 45 * 60_000;
  /** ключ ukrainealarm відхилено (401/403): 10 хв працюємо через дзеркало, потім пробуємо знову */
  private keyRejectedAt = 0;
  static KEY_RETRY_MS = 10 * 60_000;
  private fetchImpl: typeof fetch;
  private o: FeedHubOpts;
  constructor(o: FeedHubOpts) { this.o = o; this.fetchImpl = o.fetchImpl ?? fetch; }

  start() {
    if (this.o.alertsUrl !== null && this.o.alertsKey && this.o.webhookUrl) {
      // офіційне джерело через вебхук: підписка, повна синхронізація через 30 с, далі контрольна раз на 30 хв.
      // Запити рознесені в часі: API віддає 401 на щільні серії запитів з одним ключем.
      setTimeout(() => void this.subscribeWebhook(), 5000);
      setTimeout(() => void this.refreshAlerts(), 30_000);
      setTimeout(() => void this.loadRegions(), FeedHub.REGIONS_DELAY_MS);
      this.timers.push(setInterval(() => void this.refreshAlerts(), 30 * 60_000));
      // між синхронізаціями оновлюємо updatedAt, щоб екран не вважав дані застарілими, поки джерело живе
      this.timers.push(setInterval(() => void this.touchAlerts(), 2 * 60_000));
    } else if (this.o.alertsUrl !== null) {
      void this.refreshAlerts();
      if (this.o.alertsKey) setTimeout(() => void this.loadRegions(), FeedHub.REGIONS_DELAY_MS);
      this.timers.push(setInterval(() => void this.refreshAlerts(), this.o.alertsKey ? UKRAINEALARM_STATUS_MS : ALERTS_REFRESH_MS));
    }
    this.timers.push(setInterval(() => void this.refreshWeatherAll(), WEATHER_REFRESH_MS));
    setTimeout(() => void this.refreshWeatherAll(), 5000);
    return this;
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }

  private async getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
    const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "SunHunterTV/1.0 (+https://tv.sun-hunter.men)", ...headers } });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  async refreshAlerts(): Promise<AlertsSnapshot | null> {
    try {
      const useOfficial = !!this.o.alertsKey && Date.now() - this.keyRejectedAt > FeedHub.KEY_RETRY_MS;
      let snap: AlertsSnapshot | null;
      if (useOfficial) {
        try { snap = await this.fetchUkrainealarm(); }
        catch (e) {
          if (!/HTTP 40[13]/.test(String(e))) throw e;
          this.keyRejectedAt = Date.now(); this.lastActionIndex = null;
          this.o.log.warn({ err: String(e) }, "ukrainealarm key rejected, falling back to mirror for 10 min");
          snap = parseAlerts(await this.getJson(this.o.alertsUrl ?? ALERTS_URL));
        }
      } else snap = parseAlerts(await this.getJson(this.o.alertsUrl ?? ALERTS_URL));
      if (!snap) return this.lastAlerts;   // індекс не змінився: лише продовжуємо TTL кешу

      const changed = alertsChanged(this.lastAlerts, snap);
      this.lastAlerts = snap;
      if (snap.source === "ukrainealarm") this.lastSyncOkAt = Date.now();
      await this.o.store.setFeed("alerts", snap, this.o.webhookUrl ? 2 * 3600 : ALERTS_TTL_S);
      if (changed) await this.o.store.notifyFeed("alerts");
      return snap;
    } catch (e) {
      this.o.log.warn({ err: String(e) }, "alerts fetch failed");
      return null;
    }
  }
  /** POST /webhook; якщо підписка вже є (4xx) — PATCH на нову адресу. Один-два запити на старт. */
  async subscribeWebhook(): Promise<boolean> {
    const base = this.o.alertsApi ?? UKRAINEALARM_API;
    const body = JSON.stringify({ webHookUrl: this.o.webhookUrl });
    const headers = { authorization: this.o.alertsKey!, "content-type": "application/json", "user-agent": "SunHunterTV/1.0 (+https://tv.sun-hunter.men)" };
    try {
      let r = await this.fetchImpl(`${base}/api/v3/webhook`, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
      if (!r.ok && r.status !== 401) {
        await new Promise((res) => setTimeout(res, 5000));
        r = await this.fetchImpl(`${base}/api/v3/webhook`, { method: "PATCH", headers, body, signal: AbortSignal.timeout(10_000) });
      }
      this.o.log.info({ status: r.status, url: this.o.webhookUrl }, r.ok ? "ukrainealarm webhook subscribed" : "ukrainealarm webhook subscription failed");
      return r.ok;
    } catch (e) { this.o.log.warn({ err: String(e) }, "ukrainealarm webhook subscribe failed"); return false; }
  }

  /** Мапа регіонів (для парсера подій вебхука). */
  get regions(): RegionIndex { return this.index; }

  /**
   * Подія з вебхука: оновлюємо тривоги кожної області, якої стосується регіон, і сповіщаємо екрани,
   * якщо змінилась активність або рівень. Невідомий regionId -> false (і спроба підвантажити /regions).
   */
  async applyWebhookEvent(ev: WebhookEvent): Promise<boolean> {
    if (!ev.oblasts.length) { void this.loadRegions(); return false; }
    const cur = this.lastAlerts ?? (await this.o.store.getFeed<AlertsSnapshot>("alerts")) ?? { updatedAt: new Date().toISOString(), source: "ukrainealarm" as const, oblasts: Object.fromEntries(OBLASTS.map((o) => [o, { active: false, since: null }])) };
    const oblasts = { ...cur.oblasts };
    let changed = false;
    for (const name of ev.oblasts) {
      const prev: OblastState = oblasts[name] ?? { active: false, since: null };
      const alerts: Record<string, OblastAlert> = { ...(prev.alerts ?? {}) };
      if (ev.active) alerts[ev.regionId] = { since: ev.at ?? new Date().toISOString(), level: ev.level };
      else delete alerts[ev.regionId];
      const next = oblastFromAlerts(alerts, prev, ev.at);
      if (next.active !== prev.active || (next.active && (next.level ?? null) !== (prev.level ?? null))) changed = true;
      oblasts[name] = next;
    }
    const snap: AlertsSnapshot = { ...cur, updatedAt: new Date().toISOString(), source: "ukrainealarm", oblasts };
    this.lastAlerts = snap;
    await this.o.store.setFeed("alerts", snap, 2 * 3600);   // між контрольними синхронізаціями кеш живе
    if (changed) await this.o.store.notifyFeed("alerts");
    return changed;
  }

  /** Подовжує updatedAt кешу без сповіщення, поки офіційне джерело нещодавно підтвердило стан. */
  async touchAlerts(): Promise<boolean> {
    if (!this.lastAlerts || Date.now() - this.lastSyncOkAt > FeedHub.SYNC_FRESH_MS) return false;
    this.lastAlerts = { ...this.lastAlerts, updatedAt: new Date().toISOString() };
    await this.o.store.setFeed("alerts", this.lastAlerts, 2 * 3600);
    return true;
  }

  /** Мапа regionId -> область: з кешу Redis або з GET /api/v3/regions (не частіше, ніж раз на годину при невдачі). */
  async loadRegions(): Promise<boolean> {
    if (!this.o.alertsKey) return false;
    if (this.regionsLoadedAt || Date.now() - this.regionsAttemptAt < FeedHub.REGIONS_RETRY_MS) return !!this.regionsLoadedAt;
    this.regionsAttemptAt = Date.now();
    const cached = regionIndexFromJson(await this.o.store.getFeed("regions"));
    if (cached) { this.index = cached; this.regionsLoadedAt = Date.now(); return true; }
    try {
      const base = this.o.alertsApi ?? UKRAINEALARM_API;
      const json = await this.getJson(`${base}/api/v3/regions`, { authorization: this.o.alertsKey });
      const index = buildRegionIndex(json, OBLASTS);
      if (index.size <= baseRegionIndex().size) throw new Error("ukrainealarm regions: empty tree");
      this.index = index; this.regionsLoadedAt = Date.now();
      await this.o.store.setFeed("regions", regionIndexToJson(index), FeedHub.REGIONS_TTL_S);
      this.o.log.info({ regions: index.size }, "ukrainealarm regions loaded");
      return true;
    } catch (e) { this.o.log.warn({ err: String(e) }, "ukrainealarm regions load failed"); return false; }
  }

  /** Повертає null, якщо lastActionIndex не змінився (повний список не читаємо). */
  private async fetchUkrainealarm(): Promise<AlertsSnapshot | null> {
    const base = this.o.alertsApi ?? UKRAINEALARM_API;
    const h = { authorization: this.o.alertsKey! };
    if (!this.o.webhookUrl) {
      const st = (await this.getJson(`${base}/api/v3/alerts/status`, h)) as { lastActionIndex?: unknown };
      if (this.lastAlerts && st?.lastActionIndex !== undefined && st.lastActionIndex === this.lastActionIndex) {
        await this.o.store.setFeed("alerts", { ...this.lastAlerts, updatedAt: new Date().toISOString() }, ALERTS_TTL_S);
        return null;
      }
      this.lastActionIndex = st?.lastActionIndex ?? null;
    }
    const json = await this.getJson(`${base}/api/v3/alerts`, h);
    learnRegions(json, this.index, OBLASTS);   // райони, вкладені в область, запам'ятовуємо для подій вебхука
    return parseUkrainealarm(json, OBLASTS, new Date(), this.index);
  }

  /** Погода для точки: з кешу або одразу з джерела (одна паралельна спроба на точку). */
  async getWeather(lat: number, lon: number): Promise<WeatherFeed | null> {
    const key = weatherKey(lat, lon);
    const cached = await this.o.store.getFeed<WeatherFeed>(`weather:${key}`);
    if (cached) return cached;
    return this.fetchWeather(lat, lon);
  }
  private fetchWeather(lat: number, lon: number): Promise<WeatherFeed | null> {
    const key = weatherKey(lat, lon);
    let p = this.inflight.get(key);
    if (p) return p;
    p = (async () => {
      try {
        const [la, lo] = key.split(",").map(Number) as [number, number];
        const w = parseWeather(await this.getJson(weatherUrl(la, lo, this.o.weatherBase)));
        await this.o.store.setFeed(`weather:${key}`, w, WEATHER_TTL_S);
        await this.o.store.notifyFeed(`weather:${key}`);
        return w;
      } catch (e) {
        this.o.log.warn({ err: String(e), key }, "weather fetch failed");
        return null;
      } finally { this.inflight.delete(key); }
    })();
    this.inflight.set(key, p);
    return p;
  }

  /** Усі точки з конфігів екранів (одна на ~5 км). */
  async refreshWeatherAll(): Promise<number> {
    const res = await this.o.db.execute(sql`select distinct config->'location' as loc from screens where config->'location' is not null and config->>'location' <> 'null'`);
    const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as { loc: ScreenLocation | string }[];
    const keys = new Map<string, [number, number]>();
    for (const r of rows) {
      const loc = typeof r.loc === "string" ? (JSON.parse(r.loc) as ScreenLocation) : r.loc;
      if (loc && typeof loc.lat === "number") keys.set(weatherKey(loc.lat, loc.lon), [loc.lat, loc.lon]);
    }
    for (const [, [lat, lon]] of keys) await this.fetchWeather(lat, lon);
    return keys.size;
  }

  async alertFor(oblast: string | null | undefined): Promise<AlertFeed | null> {
    if (!oblast) return null;
    const snap = await this.o.store.getFeed<AlertsSnapshot>("alerts");
    const o = snap?.oblasts[oblast];
    if (!snap || !o) return null;
    return { updatedAt: snap.updatedAt, oblast, active: o.active, since: o.since, level: o.level ?? null };
  }

  /** Стрічки для конкретного екрана (за його локацією). */
  async forScreen(loc: ScreenLocation | null | undefined): Promise<ScreenFeeds> {
    if (!loc) return { weather: null, alert: null };
    const [weather, alert] = await Promise.all([this.getWeather(loc.lat, loc.lon), this.alertFor(loc.oblast)]);
    return { weather, alert };
  }
}

/** Чи стосується оновлення стрічки цього екрана. */
export function feedMatches(key: string, loc: ScreenLocation | null | undefined): "alert" | "weather" | null {
  if (!loc) return null;
  if (key === "alerts") return loc.oblast ? "alert" : null;
  if (key === `weather:${weatherKey(loc.lat, loc.lon)}`) return "weather";
  return null;
}
