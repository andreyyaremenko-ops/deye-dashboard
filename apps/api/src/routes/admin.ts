import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import * as adm from "../admin/service.ts";
import * as dev from "../devices/service.ts";
import * as fw from "../firmware/service.ts";
import { loggerFrames } from "../db/schema.ts";
import { badRequest } from "../lib/errors.ts";
import { orgParams, requireAdmin, withViewers, type Deps } from "./common.ts";

/** Панель суперадміна: огляд, тарифи вручну, прошивки, реєстрація пристроїв, сирі кадри стіків. */
export async function adminRoutes(app: FastifyInstance, deps: Deps) {
  const { db, store } = deps;
  app.addHook("preHandler", async (req) => { requireAdmin(req); });   // після auth-плагіна (той теж preHandler)

  app.get("/api/admin/overview", async () => adm.overview(db));
  app.get("/api/admin/devices/all", async () => adm.allDevices(db));
  app.get("/api/admin/screens", async () => withViewers(store, await adm.allScreens(db)));
  app.get("/api/admin/payments", async () => adm.allPayments(db));
  app.patch("/api/admin/orgs/:orgId/plan", async (req) => {
    const { orgId } = orgParams.parse(req.params);
    const { planId, planUntil } = z.object({ planId: z.string(), planUntil: z.coerce.date().nullable() }).parse(req.body);
    const r = await adm.setOrgPlan(db, orgId, planId, planUntil);
    await store.notifyScreen("*");
    return r;
  });
  // реєстрація пристроїв (виробництво)
  app.post("/api/admin/devices", async (req, reply) => {
    const body = z.object({ id: z.string(), secret: z.string().min(16).optional(), claimCode: z.string().optional(), hw: z.string().optional() }).parse(req.body);
    return reply.code(201).send(await dev.registerDevice(db, body.id, body));
  });

  // ---------------- прошивки (OTA)
  app.get("/api/admin/firmware", async () => fw.listFirmware(db));
  app.post("/api/admin/firmware", async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest("No file", "no_file");
    const f = (k: string) => { const v = (file.fields as Record<string, { value?: string } | undefined>)[k]; return v?.value; };
    const meta = z.object({ hw: z.string(), channel: z.string(), version: z.string(), notes: z.string().optional() })
      .parse({ hw: f("hw"), channel: f("channel"), version: f("version"), notes: f("notes") });
    return reply.code(201).send(await fw.uploadFirmware(db, deps.mediaRoot, meta, file.file));
  });

  // сирі кадри Solarman-стіків (аналіз протоколу)
  app.get("/api/admin/logger-frames", async (req) => {
    const q = z.object({ serial: z.coerce.number().optional(), limit: z.coerce.number().min(1).max(500).default(50) }).parse(req.query);
    const rows = await db.select().from(loggerFrames).where(q.serial ? eq(loggerFrames.serial, q.serial) : undefined).orderBy(desc(loggerFrames.receivedAt)).limit(q.limit);
    return rows.map((r) => ({ ...r, frame: r.frame.toString("hex") }));
  });
}
