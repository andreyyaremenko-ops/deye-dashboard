/** Спільне для модулів маршрутів: схеми параметрів, перевірка ролі, superadmin, глядачі екранів. */
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/plugin.ts";
import type { AppDeps } from "../app.ts";
import { requireRole } from "../orgs/service.ts";
import { describeUa } from "../admin/service.ts";
import type { StateStore } from "../state/store.ts";
import { forbidden } from "../lib/errors.ts";
import type { OrgRole } from "@deye/shared";

export type Deps = AppDeps;
export const uuid = z.string().uuid();
export const orgParams = z.object({ orgId: uuid });
export const orgDeviceParams = z.object({ orgId: uuid, deviceId: z.string() });
export const orgScreenParams = z.object({ orgId: uuid, screenId: uuid });
export const orgIdParams = z.object({ orgId: uuid, id: uuid });
export const tokenParams = z.object({ token: z.string().min(20) });

/** Залогінений учасник організації з роллю не нижче minRole; повертає користувача і розібрані params. */
export async function member<P extends { orgId: string }>(deps: Deps, req: FastifyRequest, schema: z.ZodType<P>, minRole: OrgRole) {
  const u = requireUser(req);
  const p = schema.parse(req.params);
  const role = await requireRole(deps.db, p.orgId, u.id, minRole);
  return { u, role, ...p };
}

export function requireAdmin(req: FastifyRequest) {
  const u = requireUser(req);
  if (!u.isSuperadmin) throw forbidden();
  return u;
}

/** Хто дивиться екран зараз: кількість і опис телевізорів (тип із UA, IP, з якого часу). */
export async function withViewers<T extends { id: string }>(store: StateStore, list: T[]) {
  return Promise.all(list.map(async (s) => {
    const v = await store.viewers(s.id);
    return { ...s, viewers: v.length, tvs: v.map((x) => ({ device: describeUa(x.ua), ip: x.ip, since: x.since })) };
  }));
}
