import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/plugin.ts";
import * as scr from "../screens/service.ts";
import { member, orgParams, orgScreenParams, withViewers, type Deps } from "./common.ts";

export async function screenRoutes(app: FastifyInstance, deps: Deps) {
  const { db, store } = deps;

  app.post("/api/orgs/:orgId/screens", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { name, config } = z.object({ name: z.string().min(1).max(100), config: z.unknown().optional() }).parse(req.body);
    return reply.code(201).send(await scr.createScreen(db, orgId, u.id, name, config ?? scr.defaultConfig));
  });
  // власник бачить, з яких телевізорів дивляться: тип пристрою, IP, з якого часу
  app.get("/api/orgs/:orgId/screens", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    return withViewers(store, await scr.listScreens(db, orgId));
  });
  app.patch("/api/orgs/:orgId/screens/:screenId", async (req) => {
    const u = requireUser(req); const { orgId, screenId } = orgScreenParams.parse(req.params);
    const patch = z.object({ name: z.string().min(1).max(100).optional(), config: z.unknown().optional() }).parse(req.body);
    const s = await scr.updateScreen(db, orgId, u.id, screenId, patch);
    await store.notifyScreen(screenId);
    return s;
  });
  app.post("/api/orgs/:orgId/screens/:screenId/rotate-token", async (req) => {
    const u = requireUser(req); const { orgId, screenId } = orgScreenParams.parse(req.params);
    const s = await scr.rotateToken(db, orgId, u.id, screenId);
    await store.notifyScreen(screenId);
    return s;
  });
  app.post("/api/orgs/:orgId/screens/:screenId/pair-code", async (req) => {
    const u = requireUser(req); const { orgId, screenId } = orgScreenParams.parse(req.params);
    return scr.issuePairCode(db, orgId, u.id, screenId);
  });
  app.delete("/api/orgs/:orgId/screens/:screenId", async (req, reply) => {
    const u = requireUser(req); const { orgId, screenId } = orgScreenParams.parse(req.params);
    await scr.deleteScreen(db, orgId, u.id, screenId);
    return reply.code(204).send();
  });
}
