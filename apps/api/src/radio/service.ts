/**
 * Радіо екрана: каталог RADIO_STATIONS + власні станції закладу.
 * Стрім грає сам телевізор напряму зі станції — сервер лише перевіряє адресу при додаванні.
 */
import { and, asc, count, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { RADIO_STATIONS, planLimitsOf, screenConfigSchema } from "@deye/shared";
import { radioStations, screens } from "../db/schema.ts";
import { badRequest, conflict, isUniqueViolation, notFound } from "../lib/errors.ts";
import { getOrgWithPlan, requireRole } from "../orgs/service.ts";
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
