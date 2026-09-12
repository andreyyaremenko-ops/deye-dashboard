import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { ZodError } from "zod";
import type { Auth } from "./auth/create-auth.ts";
import { authPlugin } from "./auth/plugin.ts";
import { HttpError } from "./lib/errors.ts";
import { registerRoutes } from "./routes.ts";
import { registerWs } from "./ws.ts";
import type { StateStore } from "./state/store.ts";

export interface AppDeps {
  db: PgDatabase<any, any, any>;
  auth: Auth;
  store: StateStore;
  publicUrl: string;
  mqttInternalUser: string;
  mqttInternalPass: string;
  mediaRoot: string;
  logger?: boolean | object;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.code ?? "error", message: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "validation", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? "internal" : "error", message: status >= 500 ? "Internal error" : (err as Error).message });
  });

  await app.register(rateLimit, { global: false });
  await app.register(multipart);
  await app.register(authPlugin, { auth: deps.auth });
  await registerWs(app, deps);
  await registerRoutes(app, deps);
  return app;
}
