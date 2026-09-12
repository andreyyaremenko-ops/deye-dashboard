import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { makeTestApp, signUp, api, makeSuperadmin, type TestApp } from "./helpers.ts";
import { clearModelCache, handleStatus, handleTelemetry, type IngestDeps } from "../src/mqtt/ingest.ts";
import { devices, telemetry, telemetryRaw } from "../src/db/schema.ts";

const payload = readFileSync(join(import.meta.dirname, "fixtures/telemetry-esp8266.json"), "utf8");
const DEVICE = "3494546462e6";

let t: TestApp;
let deps: IngestDeps;
const published: { topic: string; payload: string; retain?: boolean }[] = [];

beforeAll(async () => {
  t = await makeTestApp();
  clearModelCache();
  deps = { db: t.db, store: t.store, publish: async (topic, payload, retain) => { published.push({ topic, payload, retain }); }, log: { info() {}, warn() {} }, minIntervalMs: 0 };
  const a = await signUp(t.app, "admin@example.com"); await makeSuperadmin(t, a.userId);
  await api(t.app, a.cookie).post("/api/admin/devices", { id: DEVICE });
});
afterAll(async () => { await t.close(); });

describe("інжест реального payload з ESP8266", () => {
  it("невідомий пристрій відкидається, сирі дані не пишуться", async () => {
    const r = await handleTelemetry(deps, "aabbccddeeff", payload);
    expect(r).toEqual({ ok: false, reason: "unknown_device" });
    expect(await t.db.select().from(telemetryRaw)).toHaveLength(0);
  });

  it("перший цикл: модель ідентифікована, cfg опубліковано, метрики розпарсені", async () => {
    const now = new Date("2026-09-12T15:00:00Z");
    const r = await handleTelemetry(deps, DEVICE, payload, now);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.parsed) throw new Error("not parsed");
    expect(r.modelId).toBe("deye-hp3");
    expect(r.metrics.state).toBe("normal");
    expect((r.metrics.grid_w as number) + (r.metrics.inv_w as number)).toBe(r.metrics.load_w);

    expect(published).toEqual([{ topic: `devices/${DEVICE}/cfg`, payload: JSON.stringify({ ranges: [[0, 22], [500, 700]], interval: 10 }), retain: true }]);

    const [d] = await t.db.select().from(devices).where(eq(devices.id, DEVICE));
    expect(d).toMatchObject({ modelId: "deye-hp3", inverterType: 6, inverterSerial: "2309208317", stickSerial: 2763543833, online: true });
    expect(d!.lastSeenAt).toEqual(now);

    const raw = await t.db.select().from(telemetryRaw);
    expect(raw.map((x) => x.startReg).sort((a, b) => a - b)).toEqual([0, 500, 560, 620, 680]);
    const rows = await t.db.select().from(telemetry);
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.find((x) => x.metric === "bat_soc")?.value).toBe(r.metrics.bat_soc);

    const s = await t.store.get(DEVICE);
    expect(s?.updatedAt).toBe(now.toISOString());
    expect(s?.metrics.load_w).toBe(r.metrics.load_w);
  });

  it("другий цикл не публікує cfg повторно", async () => {
    await handleTelemetry(deps, DEVICE, payload, new Date("2026-09-12T15:00:10Z"));
    expect(published).toHaveLength(1);
    expect(await t.db.select().from(telemetryRaw)).toHaveLength(10);
  });

  it("rate-limit: два повідомлення за 2 с — друге відкидається", async () => {
    const d2 = { ...deps, minIntervalMs: 2000 };
    const t0 = new Date("2026-09-12T16:00:00Z");
    expect((await handleTelemetry(d2, DEVICE, payload, t0)).ok).toBe(true);
    expect(await handleTelemetry(d2, DEVICE, payload, new Date(t0.getTime() + 500))).toEqual({ ok: false, reason: "rate_limited" });
    expect((await handleTelemetry(d2, DEVICE, payload, new Date(t0.getTime() + 2500))).ok).toBe(true);
  });

  it("битий payload відкидається", async () => {
    expect(await handleTelemetry(deps, DEVICE, JSON.stringify({ seq: 1 }))).toEqual({ ok: false, reason: "bad_payload" });
    expect(await handleTelemetry(deps, DEVICE, JSON.stringify({ seq: 1, ts: 0, uptime: 1, stick: 1, ranges: [{ start: 0, regs: "abc" }] }))).toEqual({ ok: false, reason: "bad_payload" });
  });

  it("status offline через LWT", async () => {
    await handleStatus(deps, DEVICE, "offline");
    const [d] = await t.db.select().from(devices).where(eq(devices.id, DEVICE));
    expect(d!.online).toBe(false);
    expect((await t.store.get(DEVICE))?.metrics.online).toBe(false);
  });
});
