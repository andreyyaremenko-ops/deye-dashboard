/**
 * Better Auth у Fastify: проксі /api/auth/* у auth.handler(Request)
 * і декоратор request.user / request.session.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { Auth } from "./create-auth.ts";
import { unauthorized } from "../lib/errors.ts";

export interface AuthUser { id: string; email: string; name: string; isSuperadmin: boolean }

declare module "fastify" {
  interface FastifyRequest { user: AuthUser | null }
}

function toWebRequest(req: FastifyRequest): Request {
  const url = new URL(req.url, `${req.protocol}://${req.headers.host ?? "localhost"}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== undefined;
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body)) : undefined,
  });
}

export const authPlugin = fp(async (app: FastifyInstance, opts: { auth: Auth }) => {
  const { auth } = opts;
  app.decorateRequest("user", null);

  // Better Auth хоче сирий body у Request; парсимо як текст, щоб не ламати підписи
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody?: string }).rawBody = body as string;   // для перевірки підписів вебхуків
    try { done(null, body.length ? JSON.parse(body as string) : undefined); }
    catch (e) { done(e as Error); }
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(req, reply) {
      const res = await auth.handler(toWebRequest(req));
      reply.status(res.status);
      res.headers.forEach((v, k) => { reply.header(k, v); });
      return reply.send(res.body ? await res.text() : null);
    },
  });

  app.addHook("preHandler", async (req) => {
    if (req.url.startsWith("/api/auth/") || req.url.startsWith("/internal/")) return;
    const headers = new Headers();
    if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
    const s = await auth.api.getSession({ headers });
    req.user = s
      ? { id: s.user.id, email: s.user.email, name: s.user.name, isSuperadmin: Boolean((s.user as any).isSuperadmin) }
      : null;
  });
});

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
