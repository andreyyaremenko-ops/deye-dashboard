import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import { firmware } from "../db/schema.ts";
import { badRequest, conflict, isUniqueViolation, notFound } from "../lib/errors.ts";

type Db = PgDatabase<any, any, any>;
export const CHANNELS = ["stable", "beta"] as const;
export const HWS = ["esp8266", "esp32"] as const;

/** Остання прошивка для hw/каналу. beta бачить і stable, якщо stable новіший. */
export async function latest(db: Db, hw: string, channel: string) {
  const rows = await db.select().from(firmware)
    .where(and(eq(firmware.hw, hw), channel === "beta" ? undefined : eq(firmware.channel, "stable")))
    .orderBy(desc(firmware.createdAt)).limit(1);
  const f = rows[0];
  if (!f) throw notFound("No firmware");
  return { version: f.version, channel: f.channel, url: `/media/${f.file}`, sha256: f.sha256, size: f.size, notes: f.notes };
}

export async function listFirmware(db: Db) {
  return db.select().from(firmware).orderBy(desc(firmware.createdAt));
}

/** superadmin: завантажити підписаний образ. Підпис перевіряє сам пристрій публічним ключем. */
export async function uploadFirmware(db: Db, mediaRoot: string, meta: { hw: string; channel: string; version: string; notes?: string }, stream: Readable) {
  if (!(HWS as readonly string[]).includes(meta.hw)) throw badRequest("bad hw");
  if (!(CHANNELS as readonly string[]).includes(meta.channel)) throw badRequest("bad channel");
  if (!/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/.test(meta.version)) throw badRequest("version must be semver");
  const rel = `firmware/${meta.hw}-${meta.version}-${meta.channel}.bin.signed`;
  await mkdir(join(mediaRoot, "firmware"), { recursive: true });
  const hash = createHash("sha256");
  const tap = new Transform({ transform(chunk, _e, cb) { hash.update(chunk); cb(null, chunk); } });
  await pipeline(stream, tap, createWriteStream(join(mediaRoot, rel)));
  const size = (await stat(join(mediaRoot, rel))).size;
  if (size < 100_000) { await unlink(join(mediaRoot, rel)).catch(() => {}); throw badRequest("file too small for a firmware image"); }
  try {
    const [row] = await db.insert(firmware).values({ hw: meta.hw, channel: meta.channel, version: meta.version, file: rel, sha256: hash.digest("hex"), size, notes: meta.notes }).returning();
    return row!;
  } catch (e) {
    await unlink(join(mediaRoot, rel)).catch(() => {});
    if (isUniqueViolation(e, "firmware_hw_channel_version_idx")) throw conflict("This version already exists for hw/channel", "version_exists");
    throw e;
  }
}
