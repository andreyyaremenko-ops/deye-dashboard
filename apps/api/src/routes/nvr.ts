import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/plugin.ts";
import * as nvr from "../nvr/service.ts";
import { httpNvrClient } from "../nvr/client.ts";
import { tokenParams, member, orgParams, type Deps } from "./common.ts";

/** Заголовки, які має сенс нести далі в обидва боки: решта (CSP, X-Frame-Options NVR) віджету лише заважає. */
const UP = ["cookie", "range", "accept", "accept-encoding", "if-none-match", "if-modified-since"];
const DOWN = ["content-type", "content-length", "cache-control", "accept-ranges", "content-range", "etag", "last-modified", "expires", "pragma"];

/** Камери закладу: налаштування NVR у кабінеті і потік для екрана через наш проксі. */
export async function nvrRoutes(app: FastifyInstance, deps: Deps) {
  const { db, store } = deps;
  const client = deps.nvr ?? httpNvrClient;
  const call = deps.nvrFetch ?? fetch;

  app.get("/api/orgs/:orgId/nvr", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "admin");
    return nvr.getSettings(db, orgId);
  });
  // зберігання одразу стукає в чуже API: rate-limit, як у радіо
  app.put("/api/orgs/:orgId/nvr", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const body = z.object({ baseUrl: z.string().trim().min(8).max(300), token: z.string().trim().min(8).max(300) }).parse(req.body);
    return nvr.saveSettings(db, orgId, u.id, body, client);
  });
  app.delete("/api/orgs/:orgId/nvr", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    await nvr.deleteSettings(db, orgId, u.id);
    return reply.code(204).send();
  });
  app.get("/api/orgs/:orgId/nvr/cameras", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const { orgId } = await member(deps, req, orgParams, "admin");
    return { cameras: await nvr.listCameras(db, orgId, client) };
  });

  // публічне: екран бере посилання на всі свої камери одним запитом (ключ NVR лишається на сервері)
  app.get("/api/public/screens/:token/cameras", async (req) => {
    const { token } = tokenParams.parse(req.params);
    return { cameras: await nvr.screenCameras(db, store, token, client) };
  });

  /**
   * Проксі HLS: домен NVR зазвичай відкритий лише для нашого IP, тому плейлист і сегменти
   * телевізор тягне через нас. Шлях зберігаємо один в один — відносні адреси всередині
   * плейлиста тоді лишаються робочими. Редирект NVR (cookieCheck) повертаємо на наш префікс.
   */
  app.get("/api/public/screens/:token/nvr/*", async (req, reply) => {
    const { token } = tokenParams.parse(req.params);
    const rest = (req.params as Record<string, string>)["*"] ?? "";
    const qs = req.url.indexOf("?");
    const search = qs >= 0 ? req.url.slice(qs) : "";
    const target = await nvr.proxyTarget(db, token, `/${rest}`, search);

    const headers: Record<string, string> = {};
    for (const h of UP) { const v = req.headers[h]; if (typeof v === "string") headers[h] = v; }
    const res = await call(target, { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });

    const prefix = `/api/public/screens/${token}/nvr`;
    const loc = res.headers.get("location");
    if (loc) {
      try { const u = new URL(loc, target); reply.header("location", `${prefix}${u.pathname}${u.search}`); }
      catch { /* нерозбірливий redirect не тягнемо далі */ }
    }
    for (const h of DOWN) { const v = res.headers.get(h); if (v) reply.header(h, v); }
    for (const c of res.headers.getSetCookie?.() ?? []) reply.header("set-cookie", c);
    reply.code(res.status);
    return res.body ? Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]) : null;
  });
}
