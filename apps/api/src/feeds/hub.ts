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
import { ALERTS_REFRESH_MS, ALERTS_TTL_S, ALERTS_URL, UKRAINEALARM_API, UKRAINEALARM_STATUS_MS, alertsChanged, parseAlerts, parseUkrainealarm, type AlertsSnapshot } from "./alerts.ts";
import { OBLASTS } from "@deye/shared";
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
  weatherBase?: string;
}

export interface ScreenFeeds { weather: WeatherFeed | null; alert: AlertFeed | null }

export class FeedHub {
  private timers: ReturnType<typeof setInterval>[] = [];
  private inflight = new Map<string, Promise<WeatherFeed | null>>();
  private lastAlerts: AlertsSnapshot | null = null;
  private lastActionIndex: unknown = null;
  /** ключ ukrainealarm відхилено (401/403): 10 хв працюємо через дзеркало, потім пробуємо знову */
  private keyRejectedAt = 0;
  static KEY_RETRY_MS = 10 * 60_000;
  private fetchImpl: typeof fetch;
  private o: FeedHubOpts;
  constructor(o: FeedHubOpts) { this.o = o; this.fetchImpl = o.fetchImpl ?? fetch; }

  start() {
    if (this.o.alertsUrl !== null) {
      void this.refreshAlerts();
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
      await this.o.store.setFeed("alerts", snap, ALERTS_TTL_S);
      if (changed) await this.o.store.notifyFeed("alerts");
      return snap;
    } catch (e) {
      this.o.log.warn({ err: String(e) }, "alerts fetch failed");
      return null;
    }
  }
  /** Повертає null, якщо lastActionIndex не змінився (повний список не читаємо). */
  private async fetchUkrainealarm(): Promise<AlertsSnapshot | null> {
    const base = this.o.alertsApi ?? UKRAINEALARM_API;
    const h = { authorization: this.o.alertsKey! };
    const st = (await this.getJson(`${base}/api/v3/alerts/status`, h)) as { lastActionIndex?: unknown };
    if (this.lastAlerts && st?.lastActionIndex !== undefined && st.lastActionIndex === this.lastActionIndex) {
      await this.o.store.setFeed("alerts", { ...this.lastAlerts, updatedAt: new Date().toISOString() }, ALERTS_TTL_S);
      return null;
    }
    const snap = parseUkrainealarm(await this.getJson(`${base}/api/v3/alerts`, h), OBLASTS);
    this.lastActionIndex = st?.lastActionIndex ?? null;
    return snap;
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
    return { updatedAt: snap.updatedAt, oblast, active: o.active, since: o.since };
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
