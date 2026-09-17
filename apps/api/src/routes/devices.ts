import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/plugin.ts";
import * as dev from "../devices/service.ts";
import * as fw from "../firmware/service.ts";
import { deviceStats } from "../stats/counters.ts";
import { isStale } from "../state/store.ts";
import { member, orgDeviceParams, orgParams, type Deps } from "./common.ts";

export async function deviceRoutes(app: FastifyInstance, deps: Deps) {
  const { db, store } = deps;

  app.post("/api/orgs/:orgId/devices/claim", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { code, name } = z.object({ code: z.string().min(6).max(12), name: z.string().max(100).optional() }).parse(req.body);
    const d = await dev.claimDevice(db, orgId, u.id, code, name);
    return reply.code(201).send({ id: d.id, name: d.name, orgId: d.orgId });
  });
  app.get("/api/orgs/:orgId/devices", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    const list = await dev.listDevices(db, orgId);
    return list.map((d) => ({ ...d, stale: d.stateUpdatedAt ? Date.now() - d.stateUpdatedAt.getTime() > 60_000 : true }));
  });
  app.patch("/api/orgs/:orgId/devices/:deviceId", async (req) => {
    const u = requireUser(req); const { orgId, deviceId } = orgDeviceParams.parse(req.params);
    const patch = z.object({ name: z.string().min(1).max(100).optional(), batteryKwh: z.number().min(0.1).max(1000).nullable().optional(), minSoc: z.number().int().min(0).max(90).optional(), pvKwp: z.number().min(0.1).max(10000).nullable().optional() }).parse(req.body);
    return dev.updateDevice(db, orgId, u.id, deviceId, patch);
  });
  app.post("/api/orgs/:orgId/devices/:deviceId/unclaim", async (req, reply) => {
    const u = requireUser(req); const { orgId, deviceId } = orgDeviceParams.parse(req.params);
    await dev.unclaimDevice(db, orgId, u.id, deviceId);
    return reply.code(204).send();
  });
  app.get("/api/orgs/:orgId/devices/:deviceId/state", async (req) => {
    const { orgId, deviceId } = await member(deps, req, orgDeviceParams, "staff");
    await dev.deviceInOrg(db, orgId, deviceId);
    const s = await store.get(deviceId);
    return s ? { ...s, stale: isStale(s) } : { deviceId, updatedAt: null, metrics: {}, stale: true };
  });
  app.get("/api/orgs/:orgId/devices/:deviceId/stats", async (req) => {
    const { orgId, deviceId } = await member(deps, req, orgDeviceParams, "staff");
    await dev.deviceInOrg(db, orgId, deviceId);
    return deviceStats(db, store, deviceId);
  });
  app.patch("/api/orgs/:orgId/devices/:deviceId/channel", async (req) => {
    const u = requireUser(req); const { orgId, deviceId } = orgDeviceParams.parse(req.params);
    const { channel } = z.object({ channel: z.enum(["stable", "beta"]) }).parse(req.body);
    await dev.setChannel(db, orgId, u.id, deviceId, channel);
    return { ok: true };
  });

  // самореєстрація відкритого скетча: rate-limit, без auth
  app.post("/api/devices/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = z.object({ id: z.string(), secret: z.string().min(24).max(128), claimCode: z.string().min(8).max(12), hw: z.string(), fw: z.string().max(40).optional() }).parse(req.body);
    return reply.code(201).send(await dev.selfRegister(db, body));
  });
  // OTA: прошивка запитує останню версію свого каналу
  app.get("/api/firmware/latest", async (req) => {
    const q = z.object({ hw: z.enum(fw.HWS), channel: z.enum(fw.CHANNELS).default("stable") }).parse(req.query);
    return fw.latest(db, q.hw, q.channel);
  });
}
