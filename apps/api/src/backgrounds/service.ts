import { and, eq, isNull, or, desc } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import { backgrounds, transcodeJobs } from "../db/schema.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { getOrgWithPlan, requireRole } from "../orgs/service.ts";

type Db = PgDatabase<any, any, any>;

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;
const ALLOWED = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo"]);
const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv", "video/x-msvideo": "avi" };

/** Стандартні (org_id null, ready) + власні цієї організації (усі статуси). */
export async function listBackgrounds(db: Db, orgId: string) {
  return db.select({
    id: backgrounds.id, orgId: backgrounds.orgId, name: backgrounds.name, category: backgrounds.category,
    status: backgrounds.status, files: backgrounds.files, preview: backgrounds.preview,
    attribution: backgrounds.attribution, license: backgrounds.license, durationS: backgrounds.durationS, createdAt: backgrounds.createdAt,
  }).from(backgrounds)
    .where(or(and(isNull(backgrounds.orgId), eq(backgrounds.status, "ready")), eq(backgrounds.orgId, orgId)))
    .orderBy(backgrounds.orgId, backgrounds.category, desc(backgrounds.createdAt));
}

export async function startUpload(db: Db, orgId: string, actorId: string, mime: string, filename: string, stream: Readable, mediaRoot: string) {
  await requireRole(db, orgId, actorId, "admin");
  const { plan } = await getOrgWithPlan(db, orgId);
  if (!plan.limits.custom_backgrounds) throw conflict("Custom backgrounds are not included in the plan", "plan_limit");
  if (!ALLOWED.has(mime)) throw badRequest(`Unsupported video type ${mime}`, "bad_type");
  const id = randomUUID();
  const rel = `uploads/${id}.${EXT[mime] ?? "mp4"}`;
  await mkdir(join(mediaRoot, "uploads"), { recursive: true });
  try {
    await pipeline(stream, createWriteStream(join(mediaRoot, rel)));
  } catch (e) {
    await unlink(join(mediaRoot, rel)).catch(() => {});
    throw e;
  }
  const name = filename.replace(/\.[^.]+$/, "").slice(0, 80) || "Моє відео";
  return db.transaction(async (tx) => {
    const [bg] = await tx.insert(backgrounds).values({ id, orgId, name, category: "Мої", license: "own", status: "uploaded", sourceFile: rel }).returning();
    await tx.insert(transcodeJobs).values({ backgroundId: id });
    return bg!;
  });
}

export async function deleteBackground(db: Db, orgId: string, actorId: string, id: string, mediaRoot: string) {
  await requireRole(db, orgId, actorId, "admin");
  const [bg] = await db.select().from(backgrounds).where(and(eq(backgrounds.id, id), eq(backgrounds.orgId, orgId)));
  if (!bg) throw notFound("Background not found");
  await db.delete(backgrounds).where(eq(backgrounds.id, id));
  for (const f of [bg.files?.["1080"], bg.files?.["720"], bg.preview, bg.sourceFile]) {
    if (f) await unlink(join(mediaRoot, f)).catch(() => {});
  }
}

export async function renameBackground(db: Db, orgId: string, actorId: string, id: string, name: string) {
  await requireRole(db, orgId, actorId, "admin");
  const [bg] = await db.update(backgrounds).set({ name }).where(and(eq(backgrounds.id, id), eq(backgrounds.orgId, orgId))).returning();
  if (!bg) throw notFound("Background not found");
  return bg;
}
