/** Прив'язка Telegram-акаунтів до закладів: одноразові коди з кабінету, список і відв'язка. */
import { randomInt } from "node:crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { organizations, telegramCodes, telegramLinks } from "../db/schema.ts";
import { conflict, notFound } from "../lib/errors.ts";

type Db = PgDatabase<any, any, any>;

export const TG_CODE_TTL_MS = 10 * 60_000;

/** Новий 6-значний код для `/start <код>`; старі коди організації лишаються дійсними до свого TTL. */
export async function issueCode(db: Db, orgId: string, actorId: string) {
  await db.delete(telegramCodes).where(lt(telegramCodes.expiresAt, new Date()));
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + TG_CODE_TTL_MS);
    const [row] = await db.insert(telegramCodes).values({ code, orgId, createdBy: actorId, expiresAt }).onConflictDoNothing().returning();
    if (row) return { code, expiresAt };
  }
  throw conflict("Could not issue a code, try again", "retry");
}

export async function listLinks(db: Db, orgId: string) {
  return db.select({ id: telegramLinks.id, tgName: telegramLinks.tgName, createdAt: telegramLinks.createdAt })
    .from(telegramLinks).where(eq(telegramLinks.orgId, orgId)).orderBy(asc(telegramLinks.createdAt));
}

export async function deleteLink(db: Db, orgId: string, id: string) {
  const res = await db.delete(telegramLinks).where(and(eq(telegramLinks.id, id), eq(telegramLinks.orgId, orgId))).returning({ id: telegramLinks.id });
  if (!res.length) throw notFound();
}

/** Код із бота: прив'язати акаунт до закладу (код одноразовий). null — коду немає або прострочений. */
export async function linkByCode(db: Db, code: string, tgUserId: number, name: string): Promise<{ orgId: string; orgName: string; already: boolean } | null> {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) return null;
  const [c] = await db.delete(telegramCodes).where(eq(telegramCodes.code, clean)).returning();
  if (!c || c.expiresAt.getTime() < Date.now()) return null;
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, c.orgId));
  if (!org) return null;
  const [row] = await db.insert(telegramLinks).values({ orgId: c.orgId, tgUserId, tgName: name, linkedBy: c.createdBy })
    .onConflictDoNothing().returning({ id: telegramLinks.id });
  return { orgId: c.orgId, orgName: org.name, already: !row };
}

/** Заклади, до яких прив'язаний акаунт. */
export async function orgsOf(db: Db, tgUserId: number) {
  return db.select({ linkId: telegramLinks.id, orgId: telegramLinks.orgId, orgName: organizations.name, tgName: telegramLinks.tgName })
    .from(telegramLinks).innerJoin(organizations, eq(organizations.id, telegramLinks.orgId))
    .where(eq(telegramLinks.tgUserId, tgUserId)).orderBy(asc(organizations.name));
}

/** Відв'язатись самому (з бота): від усіх закладів. */
export async function unlinkAll(db: Db, tgUserId: number) {
  const res = await db.delete(telegramLinks).where(eq(telegramLinks.tgUserId, tgUserId)).returning({ id: telegramLinks.id });
  return res.length;
}
