import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as live from "../live/service.ts";
import { conflict } from "../lib/errors.ts";
import { member, orgIdParams, orgParams, type Deps } from "./common.ts";

/** Прямі трансляції закладу: список із ключем публікації — для персоналу, що веде трансляцію; створення й видалення — адмін. */
export async function liveRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  app.get("/api/orgs/:orgId/live", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    return live.listStreams(db, orgId);
  });
  app.post("/api/orgs/:orgId/live", async (req, reply) => {
    const { orgId } = await member(deps, req, orgParams, "admin");
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    if ((await live.listStreams(db, orgId)).length >= live.MAX_LIVE_STREAMS) throw conflict(`Не більше ${live.MAX_LIVE_STREAMS} трансляцій`, "limit");
    return reply.code(201).send(await live.createStream(db, orgId, name));
  });
  app.post("/api/orgs/:orgId/live/:id/rotate-key", async (req) => {
    const { orgId, id } = await member(deps, req, orgIdParams, "admin");
    return live.rotateKey(db, orgId, id);
  });
  app.delete("/api/orgs/:orgId/live/:id", async (req, reply) => {
    const { orgId, id } = await member(deps, req, orgIdParams, "admin");
    await live.deleteStream(db, orgId, id);
    return reply.code(204).send();
  });
}
