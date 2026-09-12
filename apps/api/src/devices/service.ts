import { and, eq, isNull } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { devices, deviceState } from "../db/schema.ts";
import { hashSecret, normalizeClaimCode, randomClaimCode, randomToken, sha256 } from "../lib/crypto.ts";
import { conflict, notFound } from "../lib/errors.ts";
import { requireRole } from "../orgs/service.ts";

type Db = PgDatabase<any, any, any>;

/**
 * Реєстрація пристрою (виробництво або superadmin). Секрет і код повертаються
 * один раз; у БД лише хеші. Для DIY-пристроїв у етапі 3 буде самореєстрація.
 */
export async function registerDevice(db: Db, id: string, opts: { secret?: string; claimCode?: string; hw?: string } = {}) {
  const deviceId = id.toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(deviceId)) throw conflict("device id must be 12 hex chars (MAC)", "bad_device_id");
  const secret = opts.secret ?? randomToken(24);
  const claimCode = normalizeClaimCode(opts.claimCode ?? randomClaimCode());
  const [existing] = await db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId));
  if (existing) throw conflict("Device already registered", "device_exists");
  await db.insert(devices).values({
    id: deviceId, secretHash: await hashSecret(secret), claimCodeHash: sha256(claimCode), hw: opts.hw,
  });
  return { deviceId, secret, claimCode };
}

/** Claim by code: привʼязка до організації, якщо пристрій ще нічий. */
export async function claimDevice(db: Db, orgId: string, actorId: string, code: string, name?: string) {
  await requireRole(db, orgId, actorId, "admin");
  const hash = sha256(normalizeClaimCode(code));
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(devices).where(eq(devices.claimCodeHash, hash)).for("update");
    if (!d) throw notFound("No device with this code");
    if (d.orgId && d.orgId !== orgId) throw conflict("Device already claimed by another organization", "already_claimed");
    if (d.orgId === orgId) return d;
    const [upd] = await tx.update(devices)
      .set({ orgId, claimedAt: new Date(), name: name ?? d.name ?? `Інвертор ${d.id.slice(-4)}` })
      .where(and(eq(devices.id, d.id), isNull(devices.orgId))).returning();
    if (!upd) throw conflict("Device was claimed concurrently", "already_claimed");
    return upd;
  });
}

/** Скидання привʼязки (перепродаж). Дані телеметрії лишаються за device_id. */
export async function unclaimDevice(db: Db, orgId: string, actorId: string, deviceId: string) {
  await requireRole(db, orgId, actorId, "owner");
  const res = await db.update(devices).set({ orgId: null, claimedAt: null })
    .where(and(eq(devices.id, deviceId), eq(devices.orgId, orgId))).returning({ id: devices.id });
  if (!res.length) throw notFound("Device not found in this organization");
}

export async function listDevices(db: Db, orgId: string) {
  return db.select({
    id: devices.id, name: devices.name, hw: devices.hw, fw: devices.fw, online: devices.online,
    lastSeenAt: devices.lastSeenAt, inverterSerial: devices.inverterSerial, inverterType: devices.inverterType,
    modelId: devices.modelId, stickSerial: devices.stickSerial,
    state: deviceState.state, stateUpdatedAt: deviceState.updatedAt,
  }).from(devices).leftJoin(deviceState, eq(deviceState.deviceId, devices.id)).where(eq(devices.orgId, orgId));
}

export async function renameDevice(db: Db, orgId: string, actorId: string, deviceId: string, name: string) {
  await requireRole(db, orgId, actorId, "admin");
  const res = await db.update(devices).set({ name }).where(and(eq(devices.id, deviceId), eq(devices.orgId, orgId))).returning();
  if (!res.length) throw notFound("Device not found");
  return res[0];
}

export async function deviceInOrg(db: Db, orgId: string, deviceId: string) {
  const [d] = await db.select().from(devices).where(and(eq(devices.id, deviceId), eq(devices.orgId, orgId)));
  if (!d) throw notFound("Device not found");
  return d;
}
