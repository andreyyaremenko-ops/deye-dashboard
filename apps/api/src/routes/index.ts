/**
 * REST-маршрути, згруповані за доменами. Кожен модуль — Fastify-плагін з власним контекстом
 * (хуки onRequest в admin/internal діють лише на їхні маршрути).
 */
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { orgRoutes } from "./orgs.ts";
import { deviceRoutes } from "./devices.ts";
import { historyRoutes } from "./history.ts";
import { billingRoutes } from "./billing.ts";
import { adminRoutes } from "./admin.ts";
import { screenRoutes } from "./screens.ts";
import { backgroundRoutes } from "./backgrounds.ts";
import { menuRoutes } from "./menus.ts";
import { radioRoutes } from "./radio.ts";
import { publicRoutes } from "./public.ts";
import { internalRoutes } from "./internal.ts";

export async function registerRoutes(app: FastifyInstance, deps: AppDeps) {
  for (const plugin of [orgRoutes, deviceRoutes, historyRoutes, billingRoutes, screenRoutes, backgroundRoutes, menuRoutes, radioRoutes, publicRoutes]) {
    await app.register(async (a) => plugin(a, deps));
  }
  await app.register(async (a) => adminRoutes(a, deps));       // preHandler: superadmin
  await app.register(async (a) => internalRoutes(a, deps));    // onRequest: лише приватні IP
}
