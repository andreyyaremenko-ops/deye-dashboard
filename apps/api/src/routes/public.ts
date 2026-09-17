import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OBLASTS, RADIO_STATIONS, guessOblast } from "@deye/shared";
import { requireUser } from "../auth/plugin.ts";
import * as scr from "../screens/service.ts";
import { deviceStats } from "../stats/counters.ts";
import { isStale } from "../state/store.ts";
import { parseWebhookEvent } from "../feeds/alerts.ts";
import { badRequest, forbidden } from "../lib/errors.ts";
import { tokenParams, type Deps } from "./common.ts";

/** Без логіну: екран для ТБ (за view-токеном), підключення кодом, довідники, вебхук тривог. */
export async function publicRoutes(app: FastifyInstance, deps: Deps) {
  const { db, store } = deps;

  app.get("/api/health", async () => ({ ok: true, ts: new Date().toISOString() }));
  app.get("/api/radio", async () => RADIO_STATIONS);
  app.get("/api/oblasts", async () => OBLASTS);

  // екран: конфіг, поточний стан пристроїв, погода/тривоги
  app.get("/api/public/screens/:token", async (req) => {
    const { token } = tokenParams.parse(req.params);
    const s = await scr.publicScreen(db, token);
    const states = await store.getMany(s.deviceIds);
    const feeds = deps.feeds ? await deps.feeds.forScreen(s.location) : { weather: null, alert: null };
    return { ...s, states: states.map((x) => ({ ...x, stale: isStale(x) })), feeds };
  });
  // місячна статистика для еко-віджета (лічильники "всього", працює і на free)
  app.get("/api/public/screens/:token/stats", async (req) => {
    const { token } = tokenParams.parse(req.params);
    const { deviceId } = z.object({ deviceId: z.string() }).parse(req.query);
    const s = await scr.publicScreen(db, token);
    if (!s.deviceIds.includes(deviceId)) throw forbidden();
    return deviceStats(db, store, deviceId);
  });
  // ТБ вводить код: rate-limit проти перебору (6 цифр)
  app.post("/api/public/pair", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { code } = z.object({ code: z.string().min(6).max(12) }).parse(req.body);
    return scr.resolvePairCode(db, code);
  });

  // геокодер для поля "Локація" в редакторі екрана (Open-Meteo, без ключа)
  app.get("/api/geocode", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    requireUser(req);
    const { q } = z.object({ q: z.string().min(2).max(80) }).parse(req.query);
    const base = deps.geocodeBase ?? "https://geocoding-api.open-meteo.com";
    const r = await fetch(`${base}/v1/search?${new URLSearchParams({ name: q, count: "6", language: "uk", countryCode: "UA" })}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw badRequest("Geocoder unavailable", "geocode");
    const j = (await r.json()) as { results?: { name: string; latitude: number; longitude: number; admin1?: string; admin2?: string; country_code?: string }[] };
    return (j.results ?? []).filter((x) => x.country_code === "UA").map((x) => ({
      name: [x.name, x.admin2, x.admin1].filter(Boolean).join(", "), lat: x.latitude, lon: x.longitude, oblast: guessOblast(x.admin1),
    }));
  });

  // вебхук ukrainealarm: секрет у шляху; тіло логуємо, поки не звірили формат
  app.post("/api/webhooks/ukrainealarm/:secret", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { secret } = z.object({ secret: z.string().min(16) }).parse(req.params);
    if (!deps.feeds || !deps.alertsWebhookSecret || secret !== deps.alertsWebhookSecret) throw forbidden();
    const ev = parseWebhookEvent(req.body, deps.feeds.regions);
    const applied = ev ? await deps.feeds.applyWebhookEvent(ev) : false;
    app.log.info({ body: req.body, parsed: ev, applied }, "ukrainealarm webhook");
    return reply.code(200).send({ ok: true, applied: !!ev && ev.oblasts.length > 0 });
  });
}
