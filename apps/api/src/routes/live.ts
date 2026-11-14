import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as live from "../live/service.ts";
import { conflict } from "../lib/errors.ts";
import { member, orgIdParams, orgParams, type Deps } from "./common.ts";

/** Прямі трансляції закладу: список із ключем і статусом — для персоналу, що веде трансляцію; створення й видалення — адмін; статус ефіру — публічно. */
export async function liveRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const online = deps.liveOnline ?? (async () => false);

  // публічне: екран з віджетом «Пряма трансляція» питає, чи є ефір (pathId і так знає кожен такий екран)
  app.get("/api/public/live/:pathId", async (req) => {
    const { pathId } = z.object({ pathId: z.string().regex(/^[a-z0-9]{16}$/) }).parse(req.params);
    return { online: await online(pathId) };
  });

  app.get("/api/orgs/:orgId/live", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    const list = await live.listStreams(db, orgId);
    return Promise.all(list.map(async (s) => ({ ...s, online: await online(s.pathId) })));
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
