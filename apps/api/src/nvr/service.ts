/**
 * Камери закладу: налаштування NVR (адреса + ключ) і видача екрану готових HLS-посилань.
 *
 * Ключ NVR не покидає сервер. Домен NVR часто закритий для сторонніх IP (наш сервер у списку,
 * телевізор закладу — ні), тому екран отримує посилання на НАШ проксі
 * /api/public/screens/<token>/nvr/<шлях у NVR>, а сегменти тягне вже звідти. Плейлисти NVR
 * посилаються відносними адресами, тож переписувати їх не треба — досить зберегти шлях.
 */
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { screenConfigSchema, type ScreenConfig } from "@deye/shared";
import { nvrServers, screens } from "../db/schema.ts";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.ts";
import { requireRole } from "../orgs/service.ts";
import type { StateStore } from "../state/store.ts";
import { NvrError, httpNvrClient, normalizeBaseUrl, type NvrCamera, type NvrClient, type NvrQuality } from "./client.ts";

type Db = PgDatabase<any, any, any>;

/** Скільки камер може бути в одному віджеті (ротація). */
export const MAX_WIDGET_CAMERAS = 8;
/** Проксі пускаємо лише на підписані стрім-адреси NVR, а не в його API. */
const STREAM_PREFIX = "/s/";
/** Підписане посилання живе добу; кешуємо з запасом, щоб не віддати екрану майже протухле. */
const LIVE_CACHE_MARGIN_MS = 60 * 60_000;
const LIVE_CACHE_MAX_S = 6 * 3600;

const httpError = (e: unknown) => {
  if (!(e instanceof NvrError)) return e;
  return e.code === "not_found" ? notFound(e.message) : badRequest(e.message, `nvr_${e.code}`);
};

export async function getSettings(db: Db, orgId: string) {
  const [row] = await db.select().from(nvrServers).where(eq(nvrServers.orgId, orgId));
  if (!row) return null;
  // ключ назад не віддаємо, лише хвіст — щоб власник упізнав, який саме зараз збережено
  return { baseUrl: row.baseUrl, tokenHint: `…${row.token.slice(-6)}`, updatedAt: row.updatedAt };
}

/** Зберегти адресу і ключ. Одразу перевіряємо їх запитом списку камер — інакше помилку побачив би лише телевізор. */
export async function saveSettings(db: Db, orgId: string, actorId: string, input: { baseUrl: string; token: string }, client: NvrClient = httpNvrClient) {
  await requireRole(db, orgId, actorId, "admin");
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const token = input.token.trim();
  if (token.length < 8) throw badRequest("Ключ NVR закороткий", "nvr_auth");
  let cameras: NvrCamera[];
  try { cameras = await client.listCameras(baseUrl, token); }
  catch (e) { throw httpError(e); }
  await db.insert(nvrServers).values({ orgId, baseUrl, token })
    .onConflictDoUpdate({ target: nvrServers.orgId, set: { baseUrl, token, updatedAt: new Date() } });
  return { baseUrl, cameras: cameras.length, online: cameras.filter((c) => c.online).length };
}

export async function deleteSettings(db: Db, orgId: string, actorId: string) {
  await requireRole(db, orgId, actorId, "admin");
  await db.delete(nvrServers).where(eq(nvrServers.orgId, orgId));
}

async function serverOf(db: Db, orgId: string) {
  const [row] = await db.select().from(nvrServers).where(eq(nvrServers.orgId, orgId));
  if (!row) throw conflict("NVR не налаштований", "nvr_missing");
  return row;
}

/** Список камер для редактора екрана. */
export async function listCameras(db: Db, orgId: string, client: NvrClient = httpNvrClient): Promise<NvrCamera[]> {
  const s = await serverOf(db, orgId);
  try { return await client.listCameras(s.baseUrl, s.token); }
  catch (e) { throw httpError(e); }
}

export interface CameraRef { id: string; quality: NvrQuality }

/**
 * Камери, на які посилаються віджети екрана: пара «камера + якість», бо один і той самий
 * потік у субякості й основній — це різні посилання. Субпотік іде першим: старі бандли ТБ
 * шукають камеру лише за id і так лишаються на дешевшому потоці.
 */
export function camerasOf(cfg: ScreenConfig): CameraRef[] {
  const refs = cfg.scenes.flatMap((sc) => sc.widgets
    .filter((w) => w.type === "camera")
    .flatMap((w) => {
      const quality: NvrQuality = w.props.quality === "main" ? "main" : "sub";
      const ids = Array.isArray(w.props.cameras) ? w.props.cameras : [];
      return ids.filter((x): x is string => typeof x === "string" && x.length > 0).map((id) => ({ id, quality }));
    }));
  const seen = new Set<string>();
  return refs.filter((r) => { const k = `${r.id}:${r.quality}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.quality === b.quality ? 0 : a.quality === "sub" ? -1 : 1));
}

async function screenRow(db: Db, viewToken: string) {
  const [row] = await db.select({ orgId: screens.orgId, config: screens.config }).from(screens).where(eq(screens.viewToken, viewToken));
  if (!row) throw notFound("Screen not found");
  const parsed = screenConfigSchema.safeParse(row.config);
  return { orgId: row.orgId, cameras: parsed.success ? camerasOf(parsed.data) : [] as CameraRef[] };
}

export interface ScreenCamera { id: string; quality: NvrQuality; hlsUrl: string | null; expiresAt: string | null; error?: string }

/**
 * Готові посилання для всіх камер екрана одним запитом: телевізор не ходить у NVR на кожне перемикання.
 * Камера, яку не вдалося відкрити, повертається з error — решта все одно показується.
 */
export async function screenCameras(db: Db, store: StateStore, viewToken: string, client: NvrClient = httpNvrClient): Promise<ScreenCamera[]> {
  const { orgId, cameras } = await screenRow(db, viewToken);
  if (!cameras.length) return [];
  const s = await serverOf(db, orgId);
  const prefix = `/api/public/screens/${viewToken}/nvr`;
  return Promise.all(cameras.map(async ({ id, quality }) => {
    try {
      const live = await cachedLive(store, orgId, id, quality, () => client.liveUrl(s.baseUrl, s.token, id, quality));
      const u = new URL(live.hlsUrl);
      if (!u.pathname.startsWith(STREAM_PREFIX)) throw new NvrError("NVR віддав посилання поза /s/", "bad_response");
      return { id, quality, hlsUrl: `${prefix}${u.pathname}${u.search}`, expiresAt: live.expiresAt || null };
    } catch (e) {
      return { id, quality, hlsUrl: null, expiresAt: null, error: e instanceof NvrError ? e.message : "камера недоступна" };
    }
  }));
}

async function cachedLive(store: StateStore, orgId: string, camera: string, quality: NvrQuality, load: () => Promise<{ hlsUrl: string; expiresAt: string }>) {
  const key = `nvr:${orgId}:${camera}:${quality}`;
  const hit = await store.getFeed<{ hlsUrl: string; expiresAt: string }>(key);
  if (hit) return hit;
  const live = await load();
  const leftS = Math.floor((Date.parse(live.expiresAt || "") - Date.now() - LIVE_CACHE_MARGIN_MS) / 1000);
  const ttl = Math.min(LIVE_CACHE_MAX_S, Number.isFinite(leftS) && leftS > 0 ? leftS : 600);
  if (ttl > 0) await store.setFeed(key, live, ttl);
  return live;
}

/** Куди слати запит проксі: адреса в NVR тієї організації, якій належить екран. */
export async function proxyTarget(db: Db, viewToken: string, path: string, search: string): Promise<string> {
  if (!path.startsWith(STREAM_PREFIX) || path.includes("..")) throw forbidden();
  const { orgId } = await screenRow(db, viewToken);
  const s = await serverOf(db, orgId);
  return `${s.baseUrl}${path}${search}`;
}
