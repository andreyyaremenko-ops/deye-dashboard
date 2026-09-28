import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/plugin.ts";
import * as radio from "../radio/service.ts";
import { probeStream } from "../radio/probe.ts";
import { member, orgIdParams, orgParams, tokenParams, type Deps } from "./common.ts";

/** Скільки чекаємо на відповідь станції; саме програвання потім не обмежене. */
const CONNECT_TIMEOUT_MS = 15_000;

/** Радіо закладу: каталог + власні станції. Додавання перевіряє стрім (див. radio/probe.ts). */
export async function radioRoutes(app: FastifyInstance, deps: Deps) {
  const { db, store } = deps;
  const probe = deps.radioProbe ?? ((url: string) => probeStream(url));
  const call = deps.radioFetch ?? fetch;

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

  // публічне: яку адресу вмикати телевізору і чи буде з неї спектр
  app.get("/api/public/screens/:token/radio", async (req) => {
    const { token } = tokenParams.parse(req.params);
    return radio.radioForScreen(db, store, token, deps.publicUrl, call);
  });

  /**
   * Проксі стріму для віджета спектра: AnalyserNode на чужому домені без CORS чує тишу,
   * а через нас потік стає свій. Вмикається лише для станцій без CORS — див. radioForScreen.
   */
  app.get("/api/public/screens/:token/radio/stream", async (req, reply) => {
    const { token } = tokenParams.parse(req.params);
    const target = await radio.streamTarget(db, token);
    // Дедлайн лише на встановлення зʼєднання. Ставити його на весь запит не можна: стрім нескінченний,
    // і AbortSignal.timeout обірвав би тіло посеред ефіру (ловилось як стабільна тиша на 26-й секунді).
    const ac = new AbortController();
    const connect = setTimeout(() => ac.abort(), CONNECT_TIMEOUT_MS);
    // телевізор пішов зі сторінки — відпускаємо станцію, інакше зʼєднання накопичуються
    reply.raw.on("close", () => ac.abort());
    const res = await call(target, { headers: { "user-agent": "deye-dashboard/1.0" }, signal: ac.signal }).finally(() => clearTimeout(connect));
    reply.code(res.status);
    reply.header("content-type", res.headers.get("content-type") ?? "audio/mpeg");
    reply.header("cache-control", "no-store");
    // стрім нескінченний: віддаємо як є, без буферизації
    return res.body ? Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]) : null;
  });
}
