import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { orgRoles } from "@deye/shared";
import { requireUser } from "../auth/plugin.ts";
import * as orgs from "../orgs/service.ts";
import { member, orgParams, uuid, type Deps } from "./common.ts";

const memberParams = z.object({ orgId: uuid, userId: z.string() });

export async function orgRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  app.get("/api/me", async (req) => {
    const u = requireUser(req);
    return { user: u, orgs: await orgs.listOrgsFor(db, u.id) };
  });
  app.post("/api/orgs", async (req, reply) => {
    const u = requireUser(req);
    const { name } = z.object({ name: z.string().min(1).max(100) }).parse(req.body);
    return reply.code(201).send(await orgs.createOrg(db, u.id, name));
  });
  app.get("/api/orgs/:orgId", async (req) => {
    const { orgId, role } = await member(deps, req, orgParams, "staff");
    const { org, plan } = await orgs.getOrgWithPlan(db, orgId);
    return { ...org, role, plan };
  });

  // ---------------- учасники
  app.get("/api/orgs/:orgId/members", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    return orgs.listMembers(db, orgId);
  });
  app.delete("/api/orgs/:orgId/members/:userId", async (req, reply) => {
    const u = requireUser(req); const { orgId, userId } = memberParams.parse(req.params);
    await orgs.removeMember(db, orgId, u.id, userId);
    return reply.code(204).send();
  });
  app.patch("/api/orgs/:orgId/members/:userId", async (req) => {
    const u = requireUser(req); const { orgId, userId } = memberParams.parse(req.params);
    const { role } = z.object({ role: z.enum(orgRoles) }).parse(req.body);
    await orgs.changeRole(db, orgId, u.id, userId, role);
    return { ok: true };
  });

  // ---------------- запрошення
  app.post("/api/orgs/:orgId/invites", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { role, ttlHours } = z.object({ role: z.enum(orgRoles).default("staff"), ttlHours: z.number().int().min(1).max(720).default(72) }).parse(req.body ?? {});
    const inv = await orgs.createInvite(db, orgId, u.id, role, ttlHours);
    return reply.code(201).send({ ...inv, url: `${deps.publicUrl}/invite/${inv.token}` });
  });
  app.get("/api/orgs/:orgId/invites", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "admin");
    return orgs.listInvites(db, orgId);
  });
  app.delete("/api/orgs/:orgId/invites/:inviteId", async (req, reply) => {
    const u = requireUser(req); const { orgId, inviteId } = z.object({ orgId: uuid, inviteId: uuid }).parse(req.params);
    await orgs.revokeInvite(db, orgId, u.id, inviteId);
    return reply.code(204).send();
  });
  app.post("/api/invites/:token/accept", async (req) => {
    const u = requireUser(req); const { token } = z.object({ token: z.string().min(10) }).parse(req.params);
    return orgs.acceptInvite(db, token, u.id);
  });
}
