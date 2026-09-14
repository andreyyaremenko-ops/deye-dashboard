import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTestApp, signUp, api, makeSuperadmin, type TestApp } from "./helpers.ts";
import { alertsChanged, kyivToIso, parseAlerts, parseUkrainealarm } from "../src/feeds/alerts.ts";
import { OBLASTS } from "@deye/shared";
import { parseWeather, weatherKey } from "../src/feeds/weather.ts";
import { FeedHub, feedMatches } from "../src/feeds/hub.ts";
import { clearModelCache, handleTelemetry, type IngestDeps } from "../src/mqtt/ingest.ts";
import { deviceStats, monthKey, resetRecordedCache } from "../src/stats/counters.ts";
import { deviceCounters } from "../src/db/schema.ts";

const ALERTS_JSON = { source: "x", cachedat: "2026-09-13 09:40:45", states: {
  "Київська область": { alertnow: true, changed: "2026-09-13 09:12:00" },
  "м. Київ": { alertnow: false, changed: "1970-01-01 03:00:00" },
  "Львівська область": { alertnow: false, changed: "2026-01-10 08:00:00" },
} };
const METEO_JSON = { current: { temperature_2m: 12.8, weather_code: 3, wind_speed_10m: 8.4, is_day: 1 },
  daily: { time: ["2026-09-13", "2026-09-14"], temperature_2m_max: [16.2, 19.2], temperature_2m_min: [12.6, 12.6], weather_code: [3, 0], shortwave_radiation_sum: [5.65, 9.38], sunrise: ["2026-09-13T06:30", "2026-09-14T06:31"], sunset: ["2026-09-13T19:16", "2026-09-14T19:14"] } };

describe("парсери стрічок", () => {
  it("тривоги: київський час -> ISO з урахуванням DST, 1970 -> невідомо", () => {
    expect(kyivToIso("2026-09-13 09:12:00")).toBe("2026-09-13T06:12:00.000Z"); // літо +3
    expect(kyivToIso("2026-01-10 08:00:00")).toBe("2026-01-10T06:00:00.000Z"); // зима +2
    expect(kyivToIso("1970-01-01 03:00:00")).toBeNull();
    const s = parseAlerts(ALERTS_JSON, new Date("2026-09-13T06:41:00Z"));
    expect(s.oblasts["Київська область"]!).toEqual({ active: true, since: "2026-09-13T06:12:00.000Z" });
    expect(s.oblasts["м. Київ"]!).toEqual({ active: false, since: null });
    expect(() => parseAlerts({})).toThrow();
  });
  it("зміна стану виявляється лише по active", () => {
    const a = parseAlerts(ALERTS_JSON);
    const b = parseAlerts({ ...ALERTS_JSON, states: { ...ALERTS_JSON.states, "м. Київ": { alertnow: true, changed: "2026-09-13 09:50:00" } } });
    expect(alertsChanged(null, a)).toBe(true);
    expect(alertsChanged(a, parseAlerts(ALERTS_JSON))).toBe(false);
    expect(alertsChanged(a, b)).toBe(true);
  });
  it("погода: MJ/m² -> kWh/m², ключ округлює до 0.05°", () => {
    const w = parseWeather(METEO_JSON);
    expect(w.current.temp).toBe(12.8); expect(w.current.isDay).toBe(true);
    expect(w.daily[1]!.sunKwhM2).toBe(2.61);
    expect(weatherKey(50.36098, 31.32173)).toBe("50.35,31.30");
    expect(weatherKey(50.37, 31.33)).toBe("50.35,31.35");
  });
});

const UA_ALERTS = [
  { regionId: "16", regionType: "State", regionName: "Луганська область", lastUpdate: "2022-04-04T16:45:00Z", activeAlerts: [{ regionId: "16", regionType: "State", type: "AIR", lastUpdate: "2022-04-04T16:45:00Z" }] },
  { regionId: "14", regionType: "State", regionName: "Київська область", lastUpdate: "2026-09-14T05:10:00Z", activeAlerts: [{ regionId: "14", regionType: "State", type: "AIR", lastUpdate: "2026-09-14T05:10:00Z" }] },
  { regionId: "31", regionType: "State", regionName: "м. Київ", activeAlerts: [{ regionId: "31", regionType: "State", type: "ARTILLERY" }] },   // не повітряна
  { regionId: "100", regionType: "District", regionName: "Бучанський район", activeAlerts: [{ regionId: "100", regionType: "District", type: "AIR" }] },
];
describe("ukrainealarm", () => {
  it("парсер: активні лише State з AIR, решта областей неактивні", () => {
    const s = parseUkrainealarm(UA_ALERTS, OBLASTS);
    expect(s.source).toBe("ukrainealarm");
    expect(s.oblasts["Київська область"]!).toEqual({ active: true, since: "2026-09-14T05:10:00.000Z" });
    expect(s.oblasts["м. Київ"]!).toEqual({ active: false, since: null });
    expect(s.oblasts["Львівська область"]!).toEqual({ active: false, since: null });
    expect(Object.keys(s.oblasts).length).toBeGreaterThanOrEqual(OBLASTS.length);
    expect(() => parseUkrainealarm({}, OBLASTS)).toThrow();
  });
  it("hub: статус без змін -> повний список не читається; зміна індексу -> читається і сповіщає", async () => {
    const calls: string[] = []; let index = 1; let alerts = UA_ALERTS;
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url); calls.push(u);
      expect((init?.headers as Record<string, string>).authorization).toBe("k:v");
      return new Response(JSON.stringify(u.endsWith("/status") ? { lastActionIndex: index } : alerts), { status: 200 });
    }) as typeof fetch;
    const t2 = await makeTestApp({ feeds: (store, db) => new FeedHub({ db, store, log: { info() {}, warn() {} }, fetchImpl: f, alertsKey: "k:v", alertsApi: "https://ua.test" }) });
    try {
      const hub = new FeedHub({ db: t2.db, store: t2.store, log: { info() {}, warn() {} }, fetchImpl: f, alertsKey: "k:v", alertsApi: "https://ua.test" });
      let events = 0; t2.store.subscribeFeeds(() => events++);
      await hub.refreshAlerts();
      expect(calls).toEqual(["https://ua.test/api/v3/alerts/status", "https://ua.test/api/v3/alerts"]); expect(events).toBe(1);
      await hub.refreshAlerts();
      expect(calls.length).toBe(3); expect(events).toBe(1);                      // лише status
      index = 2; alerts = UA_ALERTS.slice(0, 1);
      await hub.refreshAlerts();
      expect(calls.length).toBe(5); expect(events).toBe(2);                      // Київська область відбій -> сповіщення
      expect((await t2.store.getFeed<{ oblasts: Record<string, { active: boolean }> }>("alerts"))!.oblasts["Київська область"]!.active).toBe(false);
    } finally { await t2.close(); }
  });
});

describe("ukrainealarm: відхилений ключ", () => {
  it("401 -> дзеркало ubilling у тому ж циклі, офіційне джерело не чіпаємо 10 хв", async () => {
    const calls: string[] = [];
    const f = (async (url: string | URL | Request) => {
      const u = String(url); calls.push(u);
      if (u.includes("ua.test")) return new Response("", { status: 401 });
      return new Response(JSON.stringify(ALERTS_JSON), { status: 200 });
    }) as typeof fetch;
    const t2 = await makeTestApp();
    try {
      const hub = new FeedHub({ db: t2.db, store: t2.store, log: { info() {}, warn() {} }, fetchImpl: f, alertsKey: "bad", alertsApi: "https://ua.test" });
      const s = await hub.refreshAlerts();
      expect(s?.source).toBe("ubilling"); expect(s?.oblasts["Київська область"]?.active).toBe(true);
      expect(calls.filter((c) => c.includes("ua.test"))).toHaveLength(1);
      await hub.refreshAlerts();
      expect(calls.filter((c) => c.includes("ua.test"))).toHaveLength(1);   // без повторних спроб
      expect(calls.filter((c) => c.includes("aerialalerts"))).toHaveLength(2);
    } finally { await t2.close(); }
  });
});

describe("FeedHub, публічний екран і статистика", () => {
  let t: TestApp; let hub: FeedHub;
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request) => {
    const u = String(url); calls.push(u);
    const body = u.includes("aerialalerts") ? ALERTS_JSON : METEO_JSON;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  let owner: ReturnType<typeof api>, orgId: string, token: string, screenId: string;
  const D = "3494546462e6";
  const payload = readFileSync(join(import.meta.dirname, "fixtures/telemetry-esp8266.json"), "utf8");

  beforeAll(async () => {
    t = await makeTestApp({ feeds: (store, db) => { hub = new FeedHub({ db, store, log: { info() {}, warn() {} }, fetchImpl: fakeFetch }); return hub; } });
    clearModelCache(); resetRecordedCache();
    const a = await signUp(t.app, "admin@example.com"); await makeSuperadmin(t, a.userId);
    const reg = (await api(t.app, a.cookie).post("/api/admin/devices", { id: D })).json();
    const o = await signUp(t.app, "o@example.com"); owner = api(t.app, o.cookie);
    orgId = (await owner.post("/api/orgs", { name: "O" })).json().id;
    await owner.post(`/api/orgs/${orgId}/devices/claim`, { code: reg.claimCode });
    const s = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "S", config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [{ id: "e", type: "eco", x: 0, y: 0, w: 20, h: 20, deviceId: D, props: {} }] } })).json();
    token = s.viewToken; screenId = s.id;
  });
  afterAll(async () => { await t.close(); });

  it("без локації feeds порожні; з локацією — погода з джерела і тривога області", async () => {
    let r = await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` });
    expect(r.json().feeds).toEqual({ weather: null, alert: null });
    await hub.refreshAlerts();
    const p = await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [{ id: "e", type: "eco", x: 0, y: 0, w: 20, h: 20, deviceId: D, props: {} }], location: { name: "Баришівка", lat: 50.36098, lon: 31.32173, oblast: "Київська область" } } });
    expect(p.statusCode).toBe(200);
    expect(t.store.notified).toContain(screenId);
    r = await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` });
    const f = r.json().feeds;
    expect(f.alert).toMatchObject({ oblast: "Київська область", active: true, since: "2026-09-13T06:12:00.000Z" });
    expect(f.weather.daily).toHaveLength(2);
    expect(r.json().location.name).toBe("Баришівка");
    // друге читання — з кешу, без запиту до Open-Meteo
    const n = calls.filter((c) => c.includes("open-meteo")).length;
    await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` });
    expect(calls.filter((c) => c.includes("open-meteo")).length).toBe(n);
    expect(calls.find((c) => c.includes("open-meteo"))).toContain("latitude=50.35&longitude=31.3");
  });

  it("сповіщення про тривогу лише при зміні стану; feedMatches по локації", async () => {
    const before = t.store.feeds.get("alerts");
    let events = 0; const off = t.store.subscribeFeeds(() => events++);
    await hub.refreshAlerts(); expect(events).toBe(0);
    expect(t.store.feeds.get("alerts")).not.toBe(before); // кеш оновлено
    off();
    const loc = { name: "x", lat: 50.36, lon: 31.32, oblast: "Київська область" };
    expect(feedMatches("alerts", loc)).toBe("alert");
    expect(feedMatches("alerts", { ...loc, oblast: null })).toBeNull();
    expect(feedMatches("weather:50.35,31.30", loc)).toBe("weather");
    expect(feedMatches("weather:50.40,31.30", loc)).toBeNull();
    expect(feedMatches("alerts", null)).toBeNull();
    expect(await hub.refreshWeatherAll()).toBe(1);
  });

  it("локація валідується", async () => {
    const p = await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [], location: { name: "x", lat: 120, lon: 0, oblast: null } } });
    expect(p.statusCode).toBe(400);
  });

  it("місячна база пишеться на першому семплі; статистика = лічильник − база; попередній місяць", async () => {
    const deps: IngestDeps = { db: t.db, store: t.store, publish: async () => {}, log: { info() {}, warn() {} }, minIntervalMs: 0 };
    const now = new Date();
    const r = await handleTelemetry(deps, D, payload, now);
    if (!r.ok || !r.parsed) throw new Error("not parsed");
    const pvTotal = r.metrics.pv_total_kwh as number;
    expect(pvTotal).toBeGreaterThan(0);
    const rows = await t.db.select().from(deviceCounters);
    expect(rows).toHaveLength(1); expect(rows[0]!.month).toBe(monthKey(now)); expect(rows[0]!.counters.pv_total_kwh).toBe(pvTotal);
    // ще семпл — без нового рядка
    await handleTelemetry(deps, D, payload, new Date(now.getTime() + 5000));
    expect(await t.db.select().from(deviceCounters)).toHaveLength(1);
    // лічильник виріс на 123.4 kWh
    const st = (await t.store.get(D))!;
    await t.store.set({ ...st, metrics: { ...st.metrics, pv_total_kwh: pvTotal + 123.4, load_total_kwh: (st.metrics.load_total_kwh as number) + 50 } });
    // база попереднього місяця: на 300 kWh менша
    const [y, m] = monthKey(now).split("-").map(Number) as [number, number];
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    await t.db.insert(deviceCounters).values({ deviceId: D, month: prev, counters: { pv_total_kwh: pvTotal - 300 } });
    const s = (await t.app.inject({ method: "GET", url: `/api/public/screens/${token}/stats?deviceId=${D}` })).json();
    expect(s.pvMonthKwh).toBe(123.4); expect(s.loadMonthKwh).toBe(50); expect(s.pvPrevMonthKwh).toBe(300);
    expect(s.co2MonthKg).toBe(56); expect(s.sinceDays).toBe(1);
    // чужий пристрій — 403
    expect((await t.app.inject({ method: "GET", url: `/api/public/screens/${token}/stats?deviceId=other` })).statusCode).toBe(403);
    // кабінет
    expect((await owner.get(`/api/orgs/${orgId}/devices/${D}/stats`)).json().pvMonthKwh).toBe(123.4);
  });

  it("pvKwp зберігається і віддається публічному екрану", async () => {
    await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [{ id: "w", type: "weather", x: 0, y: 0, w: 20, h: 20, deviceId: D, props: {} }] } });
    expect((await owner.patch(`/api/orgs/${orgId}/devices/${D}`, { pvKwp: 12.5 })).json().pvKwp).toBe(12.5);
    const r = (await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` })).json();
    expect(r.devices[0].pvKwp).toBe(12.5);
    expect((await t.app.inject({ method: "GET", url: "/api/oblasts" })).json()).toContain("м. Київ");
  });
});
