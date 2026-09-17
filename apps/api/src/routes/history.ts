import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import * as dev from "../devices/service.ts";
import * as hist from "../history/service.ts";
import * as scr from "../screens/service.ts";
import { screens } from "../db/schema.ts";
import { forbidden } from "../lib/errors.ts";
import { member, orgDeviceParams, tokenParams, type Deps } from "./common.ts";

const histQuery = z.object({
  metrics: z.string().default("pv_w,load_w,grid_w,bat_soc"),
  from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  step: z.enum(["1m", "5m", "15m", "1h", "1d"]).default("15m"),
});

/** Історія телеметрії (тариф з history_days): кабінет і публічний графік на ТБ. */
export async function historyRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  app.get("/api/orgs/:orgId/devices/:deviceId/history", async (req) => {
    const { orgId, deviceId } = await member(deps, req, orgDeviceParams, "staff");
    await dev.deviceInOrg(db, orgId, deviceId);
    const q = histQuery.parse(req.query);
    const to = q.to ?? new Date(); const from = q.from ?? new Date(to.getTime() - 86400_000);
    const w = await hist.historyWindow(db, orgId, from, to);
    return { ...(await hist.series(db, deviceId, q.metrics.split(","), w.from, w.to, q.step)), from: w.from, to: w.to, historyDays: w.days };
  });
  app.get("/api/orgs/:orgId/devices/:deviceId/history/daily", async (req) => {
    const { orgId, deviceId } = await member(deps, req, orgDeviceParams, "staff");
    await dev.deviceInOrg(db, orgId, deviceId);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(92).default(30) }).parse(req.query);
    const w = await hist.historyWindow(db, orgId, new Date(Date.now() - days * 86400_000), new Date());
    return hist.daily(db, deviceId, Math.min(days, w.days));
  });
  // публічний: для віджета графіка на ТБ (лише пристрої екрана, лише якщо тариф має історію)
  app.get("/api/public/screens/:token/history", async (req) => {
    const { token } = tokenParams.parse(req.params);
    const q = z.object({ deviceId: z.string(), metrics: z.string().default("pv_w,load_w"), hours: z.coerce.number().int().min(1).max(168).default(24), step: z.enum(["5m", "15m", "1h"]).default("15m") }).parse(req.query);
    const s = await scr.publicScreen(db, token);
    if (!s.deviceIds.includes(q.deviceId)) throw forbidden();
    const [row] = await db.select({ orgId: screens.orgId }).from(screens).where(eq(screens.id, s.id));
    const to = new Date(); const w = await hist.historyWindow(db, row!.orgId, new Date(to.getTime() - q.hours * 3600_000), to);
    return hist.series(db, q.deviceId, q.metrics.split(","), w.from, w.to, q.step);
  });
}
