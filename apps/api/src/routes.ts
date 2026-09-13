import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { orgRoles, OBLASTS, RADIO_STATIONS, guessOblast } from "@deye/shared";
import { deviceStats } from "./stats/counters.ts";
import { requireUser } from "./auth/plugin.ts";
import type { AppDeps } from "./app.ts";
import * as orgs from "./orgs/service.ts";
import * as dev from "./devices/service.ts";
import * as scr from "./screens/service.ts";
import * as bgs from "./backgrounds/service.ts";
import * as fw from "./firmware/service.ts";
import * as hist from "./history/service.ts";
import * as bill from "./billing/service.ts";
import * as adm from "./admin/service.ts";
import { verifyMonoSignature } from "./billing/mono.ts";
import { ACC, mqttAclCheck, mqttAuth, mqttSuperuser } from "./mqtt/acl.ts";
import { isStale } from "./state/store.ts";
import { screens } from "./db/schema.ts";
import { eq } from "drizzle-orm";
import { badRequest, forbidden } from "./lib/errors.ts";

const uuid = z.string().uuid();
const orgParams = z.object({ orgId: uuid });

export async function registerRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, store } = deps;

  app.get("/api/health", async () => ({ ok: true, ts: new Date().toISOString() }));
  app.get("/api/radio", async () => RADIO_STATIONS);

  app.get("/api/me", async (req) => {
    const u = requireUser(req);
    return { user: u, orgs: await orgs.listOrgsFor(db, u.id) };
  });

  // ---------------- organizations
  app.post("/api/orgs", async (req, reply) => {
    const u = requireUser(req);
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
    return reply.code(201).send(await orgs.createOrg(db, u.id, name));
  });
  app.get("/api/orgs/:orgId", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const role = await orgs.requireRole(db, orgId, u.id, "staff");
    const { org, plan } = await orgs.getOrgWithPlan(db, orgId);
    return { ...org, role, plan };
  });
  app.get("/api/orgs/:orgId/members", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    return orgs.listMembers(db, orgId);
  });
  app.delete("/api/orgs/:orgId/members/:userId", async (req, reply) => {
    const u = requireUser(req); const { orgId, userId } = z.object({ orgId: uuid, userId: z.string() }).parse(req.params);
    await orgs.removeMember(db, orgId, u.id, userId);
    return reply.code(204).send();
  });
  app.patch("/api/orgs/:orgId/members/:userId", async (req) => {
    const u = requireUser(req); const { orgId, userId } = z.object({ orgId: uuid, userId: z.string() }).parse(req.params);
    const { role } = z.object({ role: z.enum(orgRoles) }).parse(req.body);
    await orgs.changeRole(db, orgId, u.id, userId, role);
    return { ok: true };
  });
  app.post("/api/orgs/:orgId/invites", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { role, ttlHours } = z.object({ role: z.enum(orgRoles).default("staff"), ttlHours: z.number().int().min(1).max(720).default(72) }).parse(req.body ?? {});
    const inv = await orgs.createInvite(db, orgId, u.id, role, ttlHours);
    return reply.code(201).send({ ...inv, url: `${deps.publicUrl}/invite/${inv.token}` });
  });
  app.get("/api/orgs/:orgId/invites", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "admin");
    return orgs.listInvites(db, orgId);
  });
  app.delete("/api/orgs/:orgId/invites/:inviteId", async (req, reply) => {
    const u = requireUser(req); const { orgId, inviteId } = z.object({ orgId: uuid, inviteId: uuid }).parse(req.params);
    await orgs.revokeInvite(db, orgId, u.id, inviteId);
    return reply.code(204).send();
  });
  app.post("/api/invites/:token/accept", async (req) => {
    const u = requireUser(req); const { token } = z.object({ token: z.string().min(10) }).parse(req.params);
    return orgs.acceptInvite(db, token, u.id);
  });

  // ---------------- devices
  app.post("/api/orgs/:orgId/devices/claim", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { code, name } = z.object({ code: z.string().min(6).max(12), name: z.string().max(100).optional() }).parse(req.body);
    const d = await dev.claimDevice(db, orgId, u.id, code, name);
    return reply.code(201).send({ id: d.id, name: d.name, orgId: d.orgId });
  });
  app.get("/api/orgs/:orgId/devices", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    const list = await dev.listDevices(db, orgId);
    return list.map((d) => ({ ...d, stale: d.stateUpdatedAt ? Date.now() - d.stateUpdatedAt.getTime() > 60_000 : true }));
  });
  app.patch("/api/orgs/:orgId/devices/:deviceId", async (req) => {
    const u = requireUser(req); const { orgId, deviceId } = z.object({ orgId: uuid, deviceId: z.string() }).parse(req.params);
    const patch = z.object({ name: z.string().min(1).max(100).optional(), batteryKwh: z.number().min(0.1).max(1000).nullable().optional(), minSoc: z.number().int().min(0).max(90).optional(), pvKwp: z.number().min(0.1).max(10000).nullable().optional() }).parse(req.body);
    return dev.updateDevice(db, orgId, u.id, deviceId, patch);
  });
  app.post("/api/orgs/:orgId/devices/:deviceId/unclaim", async (req, reply) => {
    const u = requireUser(req); const { orgId, deviceId } = z.object({ orgId: uuid, deviceId: z.string() }).parse(req.params);
    await dev.unclaimDevice(db, orgId, u.id, deviceId);
    return reply.code(204).send();
  });
  app.get("/api/orgs/:orgId/devices/:deviceId/state", async (req) => {
    const u = requireUser(req); const { orgId, deviceId } = z.object({ orgId: uuid, deviceId: z.string() }).parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    await dev.deviceInOrg(db, orgId, deviceId);
    const s = await store.get(deviceId);
    return s ? { ...s, stale: isStale(s) } : { deviceId, updatedAt: null, metrics: {}, stale: true };
  });

  // самореєстрація відкритого скетча: rate-limit, без auth
  app.post("/api/devices/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ id: z.string(), secret: z.string().min(24).max(128), claimCode: z.string().min(8).max(12), hw: z.string(), fw: z.string().max(40).optional() }).parse(req.body);
    return reply.code(201).send(await dev.selfRegister(db, body));
  });
  app.patch("/api/orgs/:orgId/devices/:deviceId/channel", async (req) => {
    const u = requireUser(req); const { orgId, deviceId } = z.object({ orgId: uuid, deviceId: z.string() }).parse(req.params);
    const { channel } = z.object({ channel: z.enum(["stable", "beta"]) }).parse(req.body);
    await dev.setChannel(db, orgId, u.id, deviceId, channel);
    return { ok: true };
  });

  // ---------------- firmware (OTA)
  app.get("/api/firmware/latest", async (req) => {
    const q = z.object({ hw: z.enum(fw.HWS), channel: z.enum(fw.CHANNELS).default("stable") }).parse(req.query);
    return fw.latest(db, q.hw, q.channel);
  });
  app.get("/api/admin/firmware", async (req) => {
    const u = requireUser(req); if (!u.isSuperadmin) throw forbidden();
    return fw.listFirmware(db);
  });
  app.post("/api/admin/firmware", async (req, reply) => {
    const u = requireUser(req); if (!u.isSuperadmin) throw forbidden();
    const file = await req.file({ limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest("No file", "no_file");
    const f = (k: string) => { const v = (file.fields as Record<string, { value?: string } | undefined>)[k]; return v?.value; };
    const meta = z.object({ hw: z.string(), channel: z.string(), version: z.string(), notes: z.string().optional() })
      .parse({ hw: f("hw"), channel: f("channel"), version: f("version"), notes: f("notes") });
    return reply.code(201).send(await fw.uploadFirmware(db, deps.mediaRoot, meta, file.file));
  });

  app.get("/api/admin/logger-frames", async (req) => {
    const u = requireUser(req); if (!u.isSuperadmin) throw forbidden();
    const q = z.object({ serial: z.coerce.number().optional(), limit: z.coerce.number().min(1).max(500).default(50) }).parse(req.query);
    const { loggerFrames } = await import("./db/schema.ts");
    const { desc, eq } = await import("drizzle-orm");
    const rows = await db.select().from(loggerFrames).where(q.serial ? eq(loggerFrames.serial, q.serial) : undefined).orderBy(desc(loggerFrames.receivedAt)).limit(q.limit);
    return rows.map((r) => ({ ...r, frame: r.frame.toString("hex") }));
  });

  // ---------------- history (pro)
  const histQuery = z.object({
    metrics: z.string().default("pv_w,load_w,grid_w,bat_soc"),
    from: z.coerce.date().optional(), to: z.coerce.date().optional(),
    step: z.enum(["1m", "5m", "15m", "1h", "1d"]).default("15m"),
  });
  app.get("/api/orgs/:orgId/devices/:deviceId/history", async (req) => {
    const u = requireUser(req); const { orgId, deviceId } = z.object({ orgId: uuid, deviceId: z.string() }).parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    await dev.deviceInOrg(db, orgId, deviceId);
    const q = histQuery.parse(req.query);
    const to = q.to ?? new Date(); const from = q.from ?? new Date(to.getTime() - 86400_000);
    const w = await hist.historyWindow(db, orgId, from, to);
    return { ...(await hist.series(db, deviceId, q.metrics.split(","), w.from, w.to, q.step)), from: w.from, to: w.to, historyDays: w.days };
  });
  app.get("/api/orgs/:orgId/devices/:deviceId/history/daily", async (req) => {
    const u = requireUser(req); const { orgId, deviceId } = z.object({ orgId: uuid, deviceId: z.string() }).parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    await dev.deviceInOrg(db, orgId, deviceId);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(92).default(30) }).parse(req.query);
    const w = await hist.historyWindow(db, orgId, new Date(Date.now() - days * 86400_000), new Date());
    return hist.daily(db, deviceId, Math.min(days, w.days));
  });
  // публічний: для віджета графіка на ТБ (лише пристрої екрана, лише якщо тариф має історію)
  app.get("/api/public/screens/:token/history", async (req) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(req.params);
    const q = z.object({ deviceId: z.string(), metrics: z.string().default("pv_w,load_w"), hours: z.coerce.number().int().min(1).max(168).default(24), step: z.enum(["5m", "15m", "1h"]).default("15m") }).parse(req.query);
    const s = await scr.publicScreen(db, token);
    if (!s.deviceIds.includes(q.deviceId)) throw forbidden();
    const [row] = await db.select({ orgId: screens.orgId }).from(screens).where(eq(screens.id, s.id));
    const to = new Date(); const w = await hist.historyWindow(db, row!.orgId, new Date(to.getTime() - q.hours * 3600_000), to);
    return hist.series(db, q.deviceId, q.metrics.split(","), w.from, w.to, q.step);
  });

  // ---------------- billing (monobank)
  const billingDeps = { db, mono: deps.mono ?? null, publicUrl: deps.publicUrl, log: app.log };
  app.get("/api/orgs/:orgId/billing", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    return { ...(await bill.billingInfo(db, orgId)), enabled: !!deps.mono };
  });
  app.post("/api/orgs/:orgId/billing/checkout", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { planId, months } = z.object({ planId: z.string().default("pro"), months: z.number().int() }).parse(req.body);
    return bill.checkout(billingDeps, orgId, u.id, planId, months);
  });
  app.get("/api/orgs/:orgId/billing/payments/:paymentId", async (req) => {
    const u = requireUser(req); const { orgId, paymentId } = z.object({ orgId: uuid, paymentId: uuid }).parse(req.params);
    return bill.refreshPayment(billingDeps, orgId, u.id, paymentId);
  });
  // вебхук monobank: сире тіло + X-Sign
  app.post("/api/billing/mono/webhook", { config: { rawBody: true } }, async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    const sign = req.headers["x-sign"];
    if (!deps.mono || typeof sign !== "string") return reply.code(400).send({ error: "no_sign" });
    const pem = await deps.mono.getPubKey();
    if (!verifyMonoSignature(raw, sign, pem)) { app.log.warn({ ip: req.ip }, "billing: bad webhook signature"); return reply.code(400).send({ error: "bad_sign" }); }
    await bill.applyStatus(billingDeps, req.body as never);
    return { ok: true };
  });

  // ---------------- superadmin panel
  const requireAdmin = (req: Parameters<typeof requireUser>[0]) => { const u = requireUser(req); if (!u.isSuperadmin) throw forbidden(); return u; };
  app.get("/api/admin/overview", async (req) => { requireAdmin(req); return adm.overview(db); });
  app.get("/api/admin/devices/all", async (req) => { requireAdmin(req); return adm.allDevices(db); });
  app.get("/api/admin/screens", async (req) => {
    requireAdmin(req);
    const list = await adm.allScreens(db);
    return Promise.all(list.map(async (s) => { const v = await store.viewers(s.id); return { ...s, viewers: v.length, tvs: v.map((x) => ({ device: adm.describeUa(x.ua), ip: x.ip, since: x.since })) }; }));
  });
  app.get("/api/admin/payments", async (req) => { requireAdmin(req); return adm.allPayments(db); });
  app.patch("/api/admin/orgs/:orgId/plan", async (req) => {
    requireAdmin(req); const { orgId } = orgParams.parse(req.params);
    const { planId, planUntil } = z.object({ planId: z.string(), planUntil: z.coerce.date().nullable() }).parse(req.body);
    const r = await adm.setOrgPlan(db, orgId, planId, planUntil);
    await store.notifyScreen("*");
    return r;
  });

  // superadmin: реєстрація пристроїв (виробництво)
  app.post("/api/admin/devices", async (req, reply) => {
    const u = requireUser(req);
    if (!u.isSuperadmin) throw forbidden();
    const body = z.object({ id: z.string(), secret: z.string().min(16).optional(), claimCode: z.string().optional(), hw: z.string().optional() }).parse(req.body);
    return reply.code(201).send(await dev.registerDevice(db, body.id, body));
  });

  // ---------------- screens
  app.post("/api/orgs/:orgId/screens", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { name, config } = z.object({ name: z.string().min(1).max(100), config: z.unknown().optional() }).parse(req.body);
    return reply.code(201).send(await scr.createScreen(db, orgId, u.id, name, config ?? scr.defaultConfig));
  });
  app.get("/api/orgs/:orgId/screens", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    const list = await scr.listScreens(db, orgId);
    const counts = await store.viewerCounts(list.map((s) => s.id));
    return list.map((s) => ({ ...s, viewers: counts[s.id] ?? 0 }));
  });
  app.patch("/api/orgs/:orgId/screens/:screenId", async (req) => {
    const u = requireUser(req); const { orgId, screenId } = z.object({ orgId: uuid, screenId: uuid }).parse(req.params);
    const patch = z.object({ name: z.string().min(1).max(100).optional(), config: z.unknown().optional() }).parse(req.body);
    const s = await scr.updateScreen(db, orgId, u.id, screenId, patch);
    await store.notifyScreen(screenId);
    return s;
  });
  app.post("/api/orgs/:orgId/screens/:screenId/rotate-token", async (req) => {
    const u = requireUser(req); const { orgId, screenId } = z.object({ orgId: uuid, screenId: uuid }).parse(req.params);
    const s = await scr.rotateToken(db, orgId, u.id, screenId);
    await store.notifyScreen(screenId);
    return s;
  });
  app.post("/api/orgs/:orgId/screens/:screenId/pair-code", async (req) => {
    const u = requireUser(req); const { orgId, screenId } = z.object({ orgId: uuid, screenId: uuid }).parse(req.params);
    return scr.issuePairCode(db, orgId, u.id, screenId);
  });
  app.delete("/api/orgs/:orgId/screens/:screenId", async (req, reply) => {
    const u = requireUser(req); const { orgId, screenId } = z.object({ orgId: uuid, screenId: uuid }).parse(req.params);
    await scr.deleteScreen(db, orgId, u.id, screenId);
    return reply.code(204).send();
  });

  // ---------------- backgrounds
  app.get("/api/orgs/:orgId/backgrounds", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    return bgs.listBackgrounds(db, orgId);
  });
  app.post("/api/orgs/:orgId/backgrounds", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const file = await req.file({ limits: { fileSize: bgs.MAX_UPLOAD_BYTES, files: 1 } });
    if (!file) throw badRequest("No file", "no_file");
    const bg = await bgs.startUpload(db, orgId, u.id, file.mimetype, file.filename, file.file, deps.mediaRoot);
    if (file.file.truncated) { await bgs.deleteBackground(db, orgId, u.id, bg.id, deps.mediaRoot); throw badRequest("File too large (max 300 MB)", "too_large"); }
    return reply.code(201).send(bg);
  });
  app.patch("/api/orgs/:orgId/backgrounds/:id", async (req) => {
    const u = requireUser(req); const { orgId, id } = z.object({ orgId: uuid, id: uuid }).parse(req.params);
    const { name } = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    return bgs.renameBackground(db, orgId, u.id, id, name);
  });
  app.delete("/api/orgs/:orgId/backgrounds/:id", async (req, reply) => {
    const u = requireUser(req); const { orgId, id } = z.object({ orgId: uuid, id: uuid }).parse(req.params);
    await bgs.deleteBackground(db, orgId, u.id, id, deps.mediaRoot);
    return reply.code(204).send();
  });

  // публічний екран: без логіну, тільки поточний стан
  app.get("/api/public/screens/:token", async (req) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(req.params);
    const s = await scr.publicScreen(db, token);
    const states = await store.getMany(s.deviceIds);
    const feeds = deps.feeds ? await deps.feeds.forScreen(s.location) : { weather: null, alert: null };
    return { ...s, states: states.map((x) => ({ ...x, stale: isStale(x) })), feeds };
  });
  // місячна статистика для еко-віджета (лічильники "всього", працює і на free)
  app.get("/api/public/screens/:token/stats", async (req) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(req.params);
    const { deviceId } = z.object({ deviceId: z.string() }).parse(req.query);
    const s = await scr.publicScreen(db, token);
    if (!s.deviceIds.includes(deviceId)) throw forbidden();
    return deviceStats(db, store, deviceId);
  });
  app.get("/api/orgs/:orgId/devices/:deviceId/stats", async (req) => {
    const u = requireUser(req); const { orgId, deviceId } = z.object({ orgId: uuid, deviceId: z.string() }).parse(req.params);
    await orgs.requireRole(db, orgId, u.id, "staff");
    await dev.deviceInOrg(db, orgId, deviceId);
    return deviceStats(db, store, deviceId);
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
  app.get("/api/oblasts", async () => OBLASTS);

  // ТБ вводить код: rate-limit проти перебору (6 цифр)
  app.post("/api/public/pair", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { code } = z.object({ code: z.string().min(6).max(12) }).parse(req.body);
    return scr.resolvePairCode(db, code);
  });

  // ---------------- internal: mosquitto-go-auth (тільки docker-мережа)
  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/internal/") && !isPrivate(req.ip)) throw forbidden();
  });
  const mqttDeps = { db, internalUser: deps.mqttInternalUser, internalPass: deps.mqttInternalPass };
  app.post("/internal/mqtt/auth", async (req, reply) => {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    return reply.code((await mqttAuth(mqttDeps, username, password)) ? 200 : 401).send();
  });
  app.post("/internal/mqtt/superuser", async (req, reply) => {
    const { username } = z.object({ username: z.string() }).parse(req.body);
    return reply.code(mqttSuperuser(mqttDeps, username) ? 200 : 403).send();
  });
  app.post("/internal/mqtt/acl", async (req, reply) => {
    const { username, topic, acc } = z.object({ username: z.string(), topic: z.string(), acc: z.coerce.number() }).parse(req.body);
    if (mqttSuperuser(mqttDeps, username)) return reply.code(200).send();
    return reply.code(mqttAclCheck(username, topic, acc) ? 200 : 403).send();
  });
  void ACC;
}

function isPrivate(ip: string): boolean {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:(127\.|10\.|192\.168\.|172\.))/.test(ip);
}
