/**
 * Історія телеметрії. date_bin замість time_bucket, щоб працювало і в PGlite (тести),
 * і в Timescale. Доступ обмежений тарифом: history_days = 0 -> 403.
 */
import { sql, eq, and, lt, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { devices, organizations, plans, telemetry } from "../db/schema.ts";
import { badRequest, conflict } from "../lib/errors.ts";
import { getOrgWithPlan } from "../orgs/service.ts";

type Db = PgDatabase<any, any, any>;

export const STEPS: Record<string, string> = { "1m": "1 minute", "5m": "5 minutes", "15m": "15 minutes", "1h": "1 hour", "1d": "1 day" };
// максимальна довжина діапазону для кроку, днів (щоб не віддавати десятки тисяч точок)
const MAX_DAYS: Record<string, number> = { "1m": 2, "5m": 14, "15m": 31, "1h": 92, "1d": 400 };
export const TZ = "Europe/Kyiv";
const METRIC_RE = /^[a-z0-9_]{1,40}$/;

/** db.execute: postgres-js повертає масив, драйвер PGlite — { rows }. */
function asRows<T>(res: unknown): T[] {
  return Array.isArray(res) ? (res as T[]) : ((res as { rows?: T[] }).rows ?? []);
}

export interface SeriesPoint { t: string; [metric: string]: number | string | null }

/** Середні значення метрик по бакетах. */
export async function series(db: Db, deviceId: string, metrics: string[], from: Date, to: Date, step: string): Promise<{ step: string; points: SeriesPoint[] }> {
  const interval = STEPS[step];
  if (!interval) throw badRequest("bad step");
  if (!metrics.length || metrics.some((m) => !METRIC_RE.test(m))) throw badRequest("bad metrics");
  if (to.getTime() - from.getTime() > MAX_DAYS[step]! * 86400_000) throw badRequest(`range too long for step ${step}`);
  const rows = await db.execute(sql`
    select date_bin(${interval}::interval, time, timestamp '2000-01-01') as bucket, metric, avg(value)::float as v
    from telemetry
    where device_id = ${deviceId} and metric in (${sql.join(metrics.map((m) => sql`${m}`), sql`, `)}) and time >= ${from.toISOString()}::timestamptz and time < ${to.toISOString()}::timestamptz
    group by 1, 2 order by 1`);
  const byT = new Map<string, SeriesPoint>();
  for (const r of asRows<{ bucket: Date | string; metric: string; v: number }>(rows)) {
    const t = new Date(r.bucket).toISOString();
    const p = byT.get(t) ?? (byT.set(t, { t }), byT.get(t)!);
    p[r.metric] = Math.round(r.v * 100) / 100;
  }
  return { step, points: [...byT.values()] };
}

/** Денні підсумки: лічильники "за день" скидаються опівночі за локальним часом інвертора -> max за добу. */
export async function daily(db: Db, deviceId: string, days: number) {
  if (days < 1 || days > 92) throw badRequest("bad days");
  const rows = await db.execute(sql`
    select (time at time zone ${TZ})::date as day, metric, max(value)::float as v
    from telemetry
    where device_id = ${deviceId} and metric in ('pv_day_kwh','gen_day_kwh','load_day_kwh','grid_buy_day_kwh','grid_sell_day_kwh','bat_charge_day_kwh','bat_discharge_day_kwh')
      and time >= (now() at time zone ${TZ})::date - ${days}::int
    group by 1, 2 order by 1`);
  const byDay = new Map<string, Record<string, number | string>>();
  for (const r of asRows<{ day: Date | string; metric: string; v: number }>(rows)) {
    const d = typeof r.day === "string" ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
    const p = byDay.get(d) ?? (byDay.set(d, { day: d }), byDay.get(d)!);
    p[r.metric] = Math.round(r.v * 10) / 10;
  }
  return [...byDay.values()];
}

/** Перевірка тарифу і обрізання from до дозволеної глибини. */
export async function historyWindow(db: Db, orgId: string, from: Date, to: Date) {
  const { plan } = await getOrgWithPlan(db, orgId);
  const days = plan.limits.history_days;
  if (!days) throw conflict("History is not included in the plan", "plan_limit");
  const minFrom = new Date(Date.now() - days * 86400_000);
  return { from: from < minFrom ? minFrom : from, to, days };
}

/** Ретенція за тарифом: раз на добу видаляємо розпарсені метрики старші за history_days (мінімум 2 доби для екрана). */
export async function runRetention(db: Db, now = new Date()) {
  const rows = await db.select({ deviceId: devices.id, limits: plans.limits, orgId: devices.orgId })
    .from(devices).leftJoin(organizations, eq(devices.orgId, organizations.id)).leftJoin(plans, eq(organizations.planId, plans.id));
  let deleted = 0;
  const groups = new Map<number, string[]>();
  for (const r of rows) {
    const days = Math.max(2, r.limits?.history_days ?? 0);
    groups.set(days, [...(groups.get(days) ?? []), r.deviceId]);
  }
  for (const [days, ids] of groups) {
    const cutoff = new Date(now.getTime() - days * 86400_000);
    const res = await db.delete(telemetry).where(and(inArray(telemetry.deviceId, ids), lt(telemetry.time, cutoff))).returning({ t: telemetry.time });
    deleted += res.length;
  }
  return deleted;
}
