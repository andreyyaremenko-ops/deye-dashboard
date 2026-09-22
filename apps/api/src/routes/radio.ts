import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/plugin.ts";
import * as radio from "../radio/service.ts";
import { probeStream } from "../radio/probe.ts";
import { member, orgIdParams, orgParams, type Deps } from "./common.ts";

/** Радіо закладу: каталог + власні станції. Додавання перевіряє стрім (див. radio/probe.ts). */
export async function radioRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const probe = deps.radioProbe ?? ((url: string) => probeStream(url));

  app.get("/api/orgs/:orgId/radio", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    return radio.listStations(db, orgId);
  });
  // кожне додавання — запит до чужого сервера: rate-limit
  app.post("/api/orgs/:orgId/radio", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const body = z.object({ title: z.string().trim().max(60).optional(), url: z.string().trim().min(8).max(500) }).parse(req.body);
    return reply.code(201).send(await radio.addStation(db, orgId, u.id, body, probe));
  });
  app.patch("/api/orgs/:orgId/radio/:id", async (req) => {
    const u = requireUser(req); const { orgId, id } = orgIdParams.parse(req.params);
    const { title } = z.object({ title: z.string().trim().min(1).max(60) }).parse(req.body);
    return radio.renameStation(db, orgId, u.id, id, title);
  });
  app.delete("/api/orgs/:orgId/radio/:id", async (req, reply) => {
    const u = requireUser(req); const { orgId, id } = orgIdParams.parse(req.params);
    await radio.deleteStation(db, orgId, u.id, id);
    return reply.code(204).send();
  });
}
