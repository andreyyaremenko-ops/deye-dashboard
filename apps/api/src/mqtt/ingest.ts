/**
 * MQTT-інжест: сирі регістри -> telemetry_raw, парсинг за картою моделі ->
 * telemetry + device_state + StateStore (WS). Ідентифікація моделі за reg 0.
 */
import { eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { decode, decodeIdentity, mapForDeviceType, rangesToTable, type RegisterMap } from "@deye/register-maps";
import { deviceInfoSchema, telemetryPayloadSchema } from "@deye/shared";
import { devices, deviceState, inverterModels, telemetry, telemetryRaw } from "../db/schema.ts";
import { recordMonthBaseline } from "../stats/counters.ts";
import type { StateStore } from "../state/store.ts";

type Db = PgDatabase<any, any, any>;

export interface IngestDeps {
  db: Db;
  store: StateStore;
  publish: (topic: string, payload: string, retain?: boolean) => Promise<void>;
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
  /** мінімальний інтервал між telemetry одного пристрою, мс (rate-limit) */
  minIntervalMs?: number;
}

const lastAccepted = new Map<string, number>();
const modelCache = new Map<string, RegisterMap>();

async function loadModel(db: Db, modelId: string): Promise<RegisterMap | undefined> {
  const cached = modelCache.get(modelId);
  if (cached) return cached;
  const [m] = await db.select().from(inverterModels).where(eq(inverterModels.id, modelId));
  if (!m) return undefined;
  const map: RegisterMap = { id: m.id, name: m.name, deviceType: m.deviceType, pollRanges: m.pollRanges, fields: m.registerMap, derived: m.derived };
  modelCache.set(modelId, map);
  return map;
}
export function clearModelCache() { modelCache.clear(); lastAccepted.clear(); }

export async function handleTelemetry(deps: IngestDeps, deviceId: string, raw: Buffer | string, now = new Date()) {
  const parsed = telemetryPayloadSchema.safeParse(JSON.parse(raw.toString()));
  if (!parsed.success) { deps.log.warn({ deviceId, issues: parsed.error.issues.slice(0, 3) }, "telemetry: bad payload"); return { ok: false as const, reason: "bad_payload" }; }
  const p = parsed.data;

  const min = deps.minIntervalMs ?? 2000;
  const last = lastAccepted.get(deviceId) ?? 0;
  if (now.getTime() - last < min) return { ok: false as const, reason: "rate_limited" };
  lastAccepted.set(deviceId, now.getTime());

  const [dev] = await deps.db.select().from(devices).where(eq(devices.id, deviceId));
  if (!dev) { deps.log.warn({ deviceId }, "telemetry: unknown device"); return { ok: false as const, reason: "unknown_device" }; }

  // 1. сирі регістри
  await deps.db.insert(telemetryRaw).values(p.ranges.map((r) => ({
    time: now, deviceId, startReg: r.start, regs: Buffer.from(r.regs, "hex"),
  })));

  const table = rangesToTable(p.ranges);
  const updates: Partial<typeof devices.$inferInsert> = { lastSeenAt: now, online: true, stickSerial: p.stick };

  // 2. ідентифікація моделі (діапазон 0..21 приходить у кожному циклі)
  let modelId = dev.modelId;
  const ident = decodeIdentity(table);
  if (ident.deviceType !== undefined) {
    updates.inverterType = ident.deviceType;
    if (ident.inverterSerial) updates.inverterSerial = ident.inverterSerial;
    if (!modelId) {
      const map = mapForDeviceType(ident.deviceType);
      if (map) {
        modelId = map.id;
        updates.modelId = map.id;
        deps.log.info({ deviceId, modelId }, "telemetry: model identified");
        // сервер керує списком регістрів для опитування
        await deps.publish(`devices/${deviceId}/cfg`, JSON.stringify({ ranges: map.pollRanges, interval: 10, channel: dev.fwChannel }), true);
      }
    }
  }
  await deps.db.update(devices).set(updates).where(eq(devices.id, deviceId));

  // 3. парсинг
  const map = modelId ? await loadModel(deps.db, modelId) : undefined;
  if (!map) return { ok: true as const, parsed: false as const, modelId: null };
  const metrics = decode(map, table);
  const numeric = Object.entries(metrics).filter((e): e is [string, number] => typeof e[1] === "number");
  if (numeric.length) {
    await deps.db.insert(telemetry).values(numeric.map(([metric, value]) => ({ time: now, deviceId, metric, value })));
  }
  const snapshot = { deviceId, updatedAt: now.toISOString(), metrics };
  await deps.db.insert(deviceState).values({ deviceId, updatedAt: now, state: metrics })
    .onConflictDoUpdate({ target: deviceState.deviceId, set: { updatedAt: now, state: metrics } });
  await deps.store.set(snapshot);
  await recordMonthBaseline(deps.db, deviceId, metrics, now);
  return { ok: true as const, parsed: true as const, modelId, metrics };
}

export async function handleStatus(deps: IngestDeps, deviceId: string, raw: Buffer | string, now = new Date()) {
  const online = raw.toString().trim() === "online";
  await deps.db.update(devices).set({ online, lastSeenAt: now }).where(eq(devices.id, deviceId));
  const s = await deps.store.get(deviceId);
  if (s) await deps.store.set({ ...s, metrics: { ...s.metrics, online } });
}

export async function handleInfo(deps: IngestDeps, deviceId: string, raw: Buffer | string) {
  const parsed = deviceInfoSchema.safeParse(JSON.parse(raw.toString()));
  if (!parsed.success) return;
  const i = parsed.data;
  await deps.db.update(devices).set({ hw: i.hw, fw: i.fw, stickSerial: i.stick_serial || undefined, lastSeenAt: new Date() })
    .where(eq(devices.id, deviceId));
}

export const TOPIC_RE = /^devices\/([0-9a-f]{12})\/(telemetry|status|info)$/;

export async function dispatch(deps: IngestDeps, topic: string, payload: Buffer) {
  const m = TOPIC_RE.exec(topic);
  if (!m) return;
  const [, id, leaf] = m;
  try {
    if (leaf === "telemetry") await handleTelemetry(deps, id!, payload);
    else if (leaf === "status") await handleStatus(deps, id!, payload);
    else if (leaf === "info") await handleInfo(deps, id!, payload);
  } catch (e) {
    deps.log.warn({ topic, err: String(e) }, "ingest error");
  }
}
void sql;
