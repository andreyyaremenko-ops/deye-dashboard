import { and, eq, sql, count } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { OrgRole } from "@deye/shared";
import { invites, memberships, organizations, plans, user } from "../db/schema.ts";
import { randomToken, sha256 } from "../lib/crypto.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts";

export type Db = PgDatabase<any, any, any>;

const ROLE_RANK: Record<OrgRole, number> = { staff: 1, admin: 2, owner: 3 };

export async function roleIn(db: Db, orgId: string, userId: string): Promise<OrgRole | null> {
  const [m] = await db.select({ role: memberships.role }).from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return m?.role ?? null;
}

/** Кидає 403, якщо користувач не має ролі >= minRole в організації. */
export async function requireRole(db: Db, orgId: string, userId: string, minRole: OrgRole): Promise<OrgRole> {
  const r = await roleIn(db, orgId, userId);
  if (!r || ROLE_RANK[r] < ROLE_RANK[minRole]) throw forbidden();
  return r;
}

async function ownerCount(db: Db, orgId: string): Promise<number> {
  const rows = await db.select({ owners: count() }).from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
  return Number(rows[0]?.owners ?? 0);
}

export async function createOrg(db: Db, ownerId: string, name: string) {
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name }).returning();
    await tx.insert(memberships).values({ orgId: org!.id, userId: ownerId, role: "owner" });
    return org!;
  });
}

export async function listOrgsFor(db: Db, userId: string) {
  return db.select({
    id: organizations.id, name: organizations.name, planId: organizations.planId, role: memberships.role,
  }).from(memberships).innerJoin(organizations, eq(memberships.orgId, organizations.id))
    .where(eq(memberships.userId, userId));
}

export async function getOrgWithPlan(db: Db, orgId: string) {
  const [row] = await db.select({ org: organizations, plan: plans }).from(organizations)
    .innerJoin(plans, eq(organizations.planId, plans.id)).where(eq(organizations.id, orgId));
  if (!row) throw notFound("Organization not found");
  return row;
}

export async function listMembers(db: Db, orgId: string) {
  return db.select({ userId: user.id, email: user.email, name: user.name, role: memberships.role, since: memberships.createdAt })
    .from(memberships).innerJoin(user, eq(memberships.userId, user.id)).where(eq(memberships.orgId, orgId));
}

/** Owner прибирає учасника. Останнього owner прибрати не можна. */
export async function removeMember(db: Db, orgId: string, actorId: string, targetId: string) {
  await requireRole(db, orgId, actorId, "owner");
  const target = await roleIn(db, orgId, targetId);
  if (!target) throw notFound("Member not found");
  if (target === "owner") {
    if (await ownerCount(db, orgId) <= 1) throw conflict("Cannot remove the last owner", "last_owner");
  }
  await db.delete(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetId)));
}

export async function changeRole(db: Db, orgId: string, actorId: string, targetId: string, role: OrgRole) {
  await requireRole(db, orgId, actorId, "owner");
  if (actorId === targetId && role !== "owner") {
    if (await ownerCount(db, orgId) <= 1) throw conflict("Cannot demote the last owner", "last_owner");
  }
  const res = await db.update(memberships).set({ role })
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, targetId))).returning();
  if (!res.length) throw notFound("Member not found");
}

/** Одноразове посилання з TTL. Сирий токен повертається один раз. */
export async function createInvite(db: Db, orgId: string, actorId: string, role: OrgRole = "staff", ttlHours = 72) {
  const actor = await requireRole(db, orgId, actorId, "admin");
  if (role === "owner" && actor !== "owner") throw forbidden("Only owner can invite owner");
  const token = randomToken(24);
  const [inv] = await db.insert(invites).values({
    orgId, role, createdBy: actorId, tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + ttlHours * 3600_000),
  }).returning();
  return { id: inv!.id, token, role, expiresAt: inv!.expiresAt };
}

export async function acceptInvite(db: Db, token: string, userId: string) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invites).where(eq(invites.tokenHash, sha256(token))).for("update");
    if (!inv) throw notFound("Invite not found");
    if (inv.usedAt) throw conflict("Invite already used", "invite_used");
    if (inv.expiresAt.getTime() < Date.now()) throw conflict("Invite expired", "invite_expired");
    const existing = await roleIn(tx, inv.orgId, userId);
    if (existing) throw conflict("Already a member", "already_member");
    await tx.insert(memberships).values({ orgId: inv.orgId, userId, role: inv.role });
    await tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, inv.id));
    return { orgId: inv.orgId, role: inv.role };
  });
}

export async function listInvites(db: Db, orgId: string) {
  return db.select({ id: invites.id, role: invites.role, expiresAt: invites.expiresAt, usedAt: invites.usedAt })
    .from(invites).where(eq(invites.orgId, orgId));
}

export async function revokeInvite(db: Db, orgId: string, actorId: string, inviteId: string) {
  await requireRole(db, orgId, actorId, "admin");
  await db.delete(invites).where(and(eq(invites.id, inviteId), eq(invites.orgId, orgId)));
}

export function assertUuid(v: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw badRequest("Bad id");
  return v;
}
void sql;
