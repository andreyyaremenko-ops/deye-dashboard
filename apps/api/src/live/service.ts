/**
 * Прямі трансляції: телефон/ноутбук шле камеру й мікрофон у MediaMTX по WebRTC (WHIP), екрани грають HLS.
 *
 * Потік живе в MediaMTX за імʼям <pathId>; ffmpeg усередині контейнера (deploy/mediamtx/tv.sh) перепаковує
 * його в <pathId>/tv зі звуком AAC — Opus із браузера телевізори не грають. Хто що може, вирішує
 * mediamtxAuth: MediaMTX питає API про кожне підключення (authHTTPAddress).
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { liveStreams } from "../db/schema.ts";
import { notFound } from "../lib/errors.ts";
import { randomToken } from "../lib/crypto.ts";

type Db = PgDatabase<any, any, any>;

/** Скільки трансляцій може мати організація: кожна — окрема адреса для віджета. */
export const MAX_LIVE_STREAMS = 5;
/** Користувач, яким ffmpeg усередині MediaMTX читає оригінал і публікує версію для ТБ. */
export const MTX_INTERNAL_USER = "mtx";

const PATH_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const newPathId = () => Array.from(randomBytes(16), (b) => PATH_ALPHABET[b % PATH_ALPHABET.length]).join("");
const PATH_RE = /^([a-z0-9]{16})(\/tv)?$/;

/** Адреси відносно домену сервісу: Caddy віддає /live/whip/* і /live/hls/* у MediaMTX. */
export const whipPath = (pathId: string) => `/live/whip/${pathId}/whip`;
export const hlsPath = (pathId: string) => `/live/hls/${pathId}/tv/index.m3u8`;

const view = (r: typeof liveStreams.$inferSelect) => ({ id: r.id, name: r.name, pathId: r.pathId, whipUrl: whipPath(r.pathId), hlsUrl: hlsPath(r.pathId), publishKey: r.publishKey, createdAt: r.createdAt });

export async function listStreams(db: Db, orgId: string) {
  const rows = await db.select().from(liveStreams).where(eq(liveStreams.orgId, orgId)).orderBy(asc(liveStreams.createdAt));
  return rows.map(view);
}

export async function createStream(db: Db, orgId: string, name: string) {
  const [row] = await db.insert(liveStreams).values({ orgId, name, pathId: newPathId(), publishKey: randomToken(24) }).returning();
  return view(row!);
}

/** Новий ключ публікації: старий перестає пускати (адреса для екранів не змінюється). */
export async function rotateKey(db: Db, orgId: string, id: string) {
  const [row] = await db.update(liveStreams).set({ publishKey: randomToken(24) }).where(and(eq(liveStreams.id, id), eq(liveStreams.orgId, orgId))).returning();
  if (!row) throw notFound();
  return view(row);
}

export async function deleteStream(db: Db, orgId: string, id: string) {
  const res = await db.delete(liveStreams).where(and(eq(liveStreams.id, id), eq(liveStreams.orgId, orgId))).returning({ id: liveStreams.id });
  if (!res.length) throw notFound();
}

/** Те, що MediaMTX надсилає на authHTTPAddress (зайві поля ігноруємо). */
export interface MtxAuthRequest { user?: string; password?: string; token?: string; ip?: string; action: string; path?: string; protocol?: string }

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const isLocal = (ip = "") => ip === "127.0.0.1" || ip === "::1";

/**
 * Рішення для MediaMTX:
 *  - ffmpeg усередині контейнера (localhost + внутрішній пароль) — читати оригінал і публікувати <id>/tv;
 *  - браузер — публікувати <id> лише по WebRTC і лише з ключем трансляції (Authorization: Bearer);
 *  - екран — читати <id>/tv лише по HLS: знати pathId достатньо, як і з посиланням на екран.
 * Усе інше (API, метрики, читання оригіналу ззовні, RTSP/RTMP/SRT) заборонено.
 */
export async function mediamtxAuth(db: Db, internalPass: string, r: MtxAuthRequest): Promise<boolean> {
  const m = PATH_RE.exec(r.path ?? "");
  if (!m) return false;
  if (internalPass && r.user === MTX_INTERNAL_USER && isLocal(r.ip) && same(r.password ?? "", internalPass))
    return r.protocol === "rtsp" && (r.action === "read" ? !m[2] : r.action === "publish" && !!m[2]);
  const [row] = await db.select({ publishKey: liveStreams.publishKey }).from(liveStreams).where(eq(liveStreams.pathId, m[1]!));
  if (!row) return false;
  if (r.action === "publish") {
    const key = r.token || r.password || "";
    return !m[2] && r.protocol === "webrtc" && !!key && same(key, row.publishKey);
  }
  return r.action === "read" && !!m[2] && r.protocol === "hls";
}
