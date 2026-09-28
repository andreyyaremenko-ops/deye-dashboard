/**
 * Радіо екрана: каталог RADIO_STATIONS + власні станції закладу.
 * Стрім грає сам телевізор напряму зі станції — сервер лише перевіряє адресу при додаванні.
 */
import { createHash } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { RADIO_STATIONS, planLimitsOf, screenConfigSchema } from "@deye/shared";
import { radioStations, screens } from "../db/schema.ts";
import { badRequest, conflict, isUniqueViolation, notFound } from "../lib/errors.ts";
import { getOrgWithPlan, requireRole } from "../orgs/service.ts";
import type { StateStore } from "../state/store.ts";
import { ProbeError, type ProbeResult } from "./probe.ts";

type Db = PgDatabase<any, any, any>;
export type Probe = (url: string) => Promise<ProbeResult>;

export async function listStations(db: Db, orgId: string) {
  const own = await db.select({ id: radioStations.id, title: radioStations.title, url: radioStations.url, sourceUrl: radioStations.sourceUrl, createdAt: radioStations.createdAt })
    .from(radioStations).where(eq(radioStations.orgId, orgId)).orderBy(asc(radioStations.title));
  return { catalog: RADIO_STATIONS, own };
}

/** Адреса, яку можна поставити в radioUrl екрана: з каталогу або власна станція цієї організації. */
export async function isAllowedRadio(db: Db, orgId: string, url: string): Promise<boolean> {
  if (RADIO_STATIONS.some((s) => s.url === url)) return true;
  const [row] = await db.select({ id: radioStations.id }).from(radioStations).where(and(eq(radioStations.orgId, orgId), eq(radioStations.url, url)));
  return !!row;
}

export async function addStation(db: Db, orgId: string, actorId: string, input: { title?: string; url: string }, probe: Probe) {
  await requireRole(db, orgId, actorId, "admin");
  const { plan } = await getOrgWithPlan(db, orgId);
  const limit = planLimitsOf(plan.limits).custom_radio;
  const [{ n }] = await db.select({ n: count() }).from(radioStations).where(eq(radioStations.orgId, orgId)) as [{ n: number }];
  if (Number(n) >= limit) throw conflict(`Plan allows ${limit} custom radio station(s)`, "plan_limit");

  let res: ProbeResult;
  try { res = await probe(input.url); }
  catch (e) {
    if (e instanceof ProbeError) throw badRequest(e.message, `radio_${e.code}`);
    throw e;
  }
  const title = (input.title?.trim() || res.name || new URL(res.url).hostname).slice(0, 60);
  if (RADIO_STATIONS.some((s) => s.url === res.url)) throw conflict("Ця станція вже є в каталозі", "radio_in_catalog");
  try {
    const [row] = await db.insert(radioStations).values({ orgId, title, url: res.url, sourceUrl: input.url.trim(), contentType: res.contentType }).returning();
    return row!;
  } catch (e) {
    if (isUniqueViolation(e, "radio_stations_org_url_idx")) throw conflict("Ця станція вже додана", "radio_exists");
    throw e;
  }
}

export async function renameStation(db: Db, orgId: string, actorId: string, id: string, title: string) {
  await requireRole(db, orgId, actorId, "admin");
  const [row] = await db.update(radioStations).set({ title }).where(and(eq(radioStations.id, id), eq(radioStations.orgId, orgId))).returning();
  if (!row) throw notFound("Station not found");
  return row;
}

/** Станцію, яка грає на якомусь екрані, не видаляємо мовчки — інакше ТБ лишиться з мертвою адресою. */
export async function deleteStation(db: Db, orgId: string, actorId: string, id: string) {
  await requireRole(db, orgId, actorId, "admin");
  const [st] = await db.select().from(radioStations).where(and(eq(radioStations.id, id), eq(radioStations.orgId, orgId)));
  if (!st) throw notFound("Station not found");
  const rows = await db.select({ name: screens.name, config: screens.config }).from(screens).where(eq(screens.orgId, orgId));
  const using = rows.filter((r) => screenConfigSchema.safeParse(r.config).data?.radioUrl === st.url).map((r) => r.name);
  if (using.length) throw conflict(`Станція грає на екранах: ${using.join(", ")}. Спершу змініть там радіо.`, "radio_in_use");
  await db.delete(radioStations).where(eq(radioStations.id, id));
}

// --- Звук для віджета спектра ---

/**
 * Віджет спектра читає звук через AnalyserNode, а той на чужому домені без CORS бачить саму тишу.
 * Тому екрану з таким віджетом ми або лишаємо пряму адресу (станція віддає Access-Control-Allow-Origin),
 * або підставляємо наш проксі — тоді потік стає свій, і аналізатор працює. Без віджета спектра нічого
 * не міняємо: радіо як і раніше грає напряму, трафік через нас не йде.
 */
const CORS_TTL_S = 6 * 3600;
const CORS_TIMEOUT_MS = 6000;

async function corsAllowed(url: string, store: StateStore, origin: string, call: typeof fetch): Promise<boolean> {
  const key = `radio:cors:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
  const hit = await store.getFeed<{ ok: boolean }>(key);
  if (hit) return hit.ok;
  let ok = false;
  try {
    const r = await call(url, { headers: { origin, range: "bytes=0-1" }, signal: AbortSignal.timeout(CORS_TIMEOUT_MS) });
    const acao = r.headers.get("access-control-allow-origin");
    ok = acao === "*" || acao === origin;
    await r.body?.cancel().catch(() => {});
  } catch { ok = false; }
  await store.setFeed(key, { ok }, CORS_TTL_S);
  return ok;
}

async function screenRadio(db: Db, viewToken: string) {
  const [row] = await db.select({ config: screens.config }).from(screens).where(eq(screens.viewToken, viewToken));
  if (!row) throw notFound("Screen not found");
  const cfg = screenConfigSchema.safeParse(row.config).data;
  const wantsSpectrum = !!cfg?.scenes.some((sc) => sc.widgets.some((w) => w.type === "spectrum"));
  return { url: cfg?.radioUrl ?? null, wantsSpectrum };
}

export interface ScreenRadio { url: string | null; proxied: boolean; analyser: boolean }

export async function radioForScreen(db: Db, store: StateStore, viewToken: string, origin: string, call: typeof fetch = fetch): Promise<ScreenRadio> {
  const { url, wantsSpectrum } = await screenRadio(db, viewToken);
  if (!url) return { url: null, proxied: false, analyser: false };
  if (!wantsSpectrum) return { url, proxied: false, analyser: false };
  if (await corsAllowed(url, store, origin, call)) return { url, proxied: false, analyser: true };
  return { url: `/api/public/screens/${viewToken}/radio/stream`, proxied: true, analyser: true };
}

/** Адреса станції цього екрана — більше проксі нікуди не ходить. */
export async function streamTarget(db: Db, viewToken: string): Promise<string> {
  const { url } = await screenRadio(db, viewToken);
  if (!url) throw notFound("Radio is off for this screen");
  return url;
}
