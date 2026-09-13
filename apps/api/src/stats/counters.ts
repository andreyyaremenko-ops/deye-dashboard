/**
 * Місячна статистика без історії: на першому семплі місяця запамʼятовуємо лічильники
 * "всього" (pv_total_kwh, ...), далі місяць = поточний лічильник − база.
 * Free-тариф зберігає телеметрію лише 2 дні, тому агрегувати з telemetry не можна.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { deviceCounters } from "../db/schema.ts";
import type { StateStore } from "../state/store.ts";
import { CO2_KG_PER_KWH } from "@deye/shared";

type Db = PgDatabase<any, any, any>;
export const TOTAL_METRICS = ["pv_total_kwh", "load_total_kwh", "grid_buy_total_kwh", "grid_sell_total_kwh", "bat_charge_total_kwh", "bat_discharge_total_kwh"] as const;
export const TZ = "Europe/Kyiv";

export function monthKey(now: Date, tz = TZ): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit" }).format(now).slice(0, 7);
}
function prevMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export function totalsOf(metrics: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of TOTAL_METRICS) if (typeof metrics[k] === "number") out[k] = metrics[k] as number;
  return out;
}

// один запит на пристрій на місяць (після рестарту — ще один no-op insert)
const recorded = new Set<string>();
export function resetRecordedCache() { recorded.clear(); }

/** Викликається з інжесту на кожному семплі; пише в БД лише перший раз за місяць. */
export async function recordMonthBaseline(db: Db, deviceId: string, metrics: Record<string, unknown>, now = new Date()) {
  const month = monthKey(now);
  const k = `${deviceId}:${month}`;
  if (recorded.has(k)) return false;
  const counters = totalsOf(metrics);
  if (!Object.keys(counters).length) return false;
  await db.insert(deviceCounters).values({ deviceId, month, counters, createdAt: now }).onConflictDoNothing();
  recorded.add(k);
  return true;
}

export interface DeviceStats {
  month: string;
  /** з якого дня рахуємо (перший семпл місяця або момент появи пристрою) */
  since: string;
  sinceDays: number;
  pvMonthKwh: number | null; loadMonthKwh: number | null; gridBuyMonthKwh: number | null; gridSellMonthKwh: number | null;
  pvPrevMonthKwh: number | null;
  pvTotalKwh: number | null;
  co2MonthKg: number | null;
}

export async function deviceStats(db: Db, store: StateStore, deviceId: string, now = new Date()): Promise<DeviceStats> {
  const month = monthKey(now), prev = prevMonthKey(month);
  const state = await store.get(deviceId);
  const cur = totalsOf(state?.metrics ?? {});
  let rows = await db.select().from(deviceCounters).where(and(eq(deviceCounters.deviceId, deviceId), inArray(deviceCounters.month, [month, prev])));
  let base = rows.find((r) => r.month === month);
  if (!base && Object.keys(cur).length) {
    // пристрій підключено до появи лічильників: база — зараз
    await db.insert(deviceCounters).values({ deviceId, month, counters: cur, createdAt: now }).onConflictDoNothing();
    rows = await db.select().from(deviceCounters).where(and(eq(deviceCounters.deviceId, deviceId), inArray(deviceCounters.month, [month, prev])));
    base = rows.find((r) => r.month === month);
  }
  const prevBase = rows.find((r) => r.month === prev);
  const delta = (k: string): number | null => (base && typeof cur[k] === "number" && typeof base.counters[k] === "number" ? Math.max(0, Math.round((cur[k]! - base.counters[k]!) * 10) / 10) : null);
  const pvMonth = delta("pv_total_kwh");
  const pvPrev = prevBase && base && typeof prevBase.counters.pv_total_kwh === "number" && typeof base.counters.pv_total_kwh === "number"
    ? Math.max(0, Math.round((base.counters.pv_total_kwh - prevBase.counters.pv_total_kwh) * 10) / 10) : null;
  const since = base?.createdAt ?? now;
  return {
    month, since: since.toISOString(), sinceDays: Math.max(1, Math.round((now.getTime() - since.getTime()) / 86400_000)),
    pvMonthKwh: pvMonth, loadMonthKwh: delta("load_total_kwh"), gridBuyMonthKwh: delta("grid_buy_total_kwh"), gridSellMonthKwh: delta("grid_sell_total_kwh"),
    pvPrevMonthKwh: pvPrev, pvTotalKwh: typeof cur.pv_total_kwh === "number" ? cur.pv_total_kwh : null,
    co2MonthKg: pvMonth === null ? null : Math.round(pvMonth * CO2_KG_PER_KWH),
  };
}
