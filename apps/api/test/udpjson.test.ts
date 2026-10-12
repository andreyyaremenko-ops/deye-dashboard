/**
 * ESP32 біля інвертора Anenji шле готові метрики в JSON по UDP.
 * Перевіряємо розбір і перевернутий знак струму батареї, самореєстрацію пристрою,
 * інжест у telemetry/device_state і привʼязку до адреси.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import dgram from "node:dgram";
import { eq } from "drizzle-orm";
import { makeTestApp, type TestApp } from "./helpers.ts";
import { startUdpJsonServer } from "../src/udpjson/server.ts";
import { toMetrics, udpClaimCode, udpDeviceId, udpPayloadSchema } from "../src/udpjson/payload.ts";
import { clearModelCache } from "../src/mqtt/ingest.ts";
import { deviceState, devices, telemetry } from "../src/db/schema.ts";

/** Реальний пакет із прода (ніч: мережі немає, живе батарея). */
const NIGHT = {
  device: "b0cbd8c7e750", ac_pow: 269.0, grid_w: 0.0, grid_v: 0.0, load_w: 252.0,
  bat_v: 53.3, bat_a: -5.6, pv_v: 0.0, pv_a: 0.0, pv_w: 0.0, ti: 22.0, td: 19.0, bc: 92,
};
const DEVICE_ID = "b0cbd8c7e750";

describe("розбір JSON з ESP32", () => {
  it("поля переносяться в наші назви", () => {
    const m = toMetrics(udpPayloadSchema.parse(NIGHT));
    expect(m.load_w).toBe(252);
    expect(m.load_va).toBe(269);
    expect(m.bat_v).toBe(53.3);
    expect(m.bat_soc).toBe(92);
    expect(m.grid_w).toBe(0);
    expect(m.grid_v_l1).toBe(0);
    expect(m.pv_w).toBe(0);
    expect(m.pv1_w).toBe(0);
    expect(m.temp_heatsink_c).toBe(22);
    expect(m.temp_dc_c).toBe(19);
  });

  it("знак струму батареї перевернуто: у нас мінус = заряд", () => {
    const night = toMetrics(udpPayloadSchema.parse(NIGHT));
    expect(night.bat_a).toBe(5.6);                 // прошивка дала -5.6 (розряд)
    expect(night.bat_w).toBeCloseTo(298.48, 2);    // розряд — додатне, як у Deye
    const day = toMetrics(udpPayloadSchema.parse({ ...NIGHT, bat_a: 12.5, pv_w: 3400, grid_v: 231.4 }));
    expect(day.bat_a).toBe(-12.5);
    expect(day.bat_w).toBeCloseTo(-666.25, 2);     // заряд — відʼємне
    expect(day.pv_w).toBe(3400);
  });

  it("лічильники кВт·г ідуть як є, сміття серед них — ні", () => {
    const m = toMetrics(udpPayloadSchema.parse({ ...NIGHT, pv_day_kwh: 6.08, load_day_kwh: 7.67, grid_buy_day_kwh: 0,
      pv_total_kwh: 1234.5, bogus_day_kwh: 5, load_day_kwh_x: 1, grid_sell_day_kwh: -3, gen_day_kwh: "7" }));
    expect(m.pv_day_kwh).toBe(6.08);
    expect(m.load_day_kwh).toBe(7.67);
    expect(m.grid_buy_day_kwh).toBe(0);
    expect(m.pv_total_kwh).toBe(1234.5);
    expect(m.bogus_day_kwh).toBeUndefined();
    expect(m.load_day_kwh_x).toBeUndefined();
    expect(m.grid_sell_day_kwh).toBeUndefined();    // відʼємний лічильник — битий
    expect(m.gen_day_kwh).toBeUndefined();          // рядок — не число
  });

  it("невідомі поля не ламають пакет, биті числа ламають", () => {
    const m = toMetrics(udpPayloadSchema.parse({ ...NIGHT, future_field: 42, note: "hi" }));
    expect(m.load_w).toBe(252);
    expect(udpPayloadSchema.safeParse({ ...NIGHT, bat_v: "53.3" }).success).toBe(false);
    expect(udpPayloadSchema.safeParse({ device: "x" }).success).toBe(false);          // імʼя закоротке
    expect(udpPayloadSchema.safeParse({ device: "b0cbd8c7e750" }).success).toBe(true); // лише імʼя — валідно
  });

  it("id пристрою: MAC як є, інше імʼя — через хеш", () => {
    expect(udpDeviceId("b0cbd8c7e750")).toBe(DEVICE_ID);
    expect(udpDeviceId("B0CBD8C7E750")).toBe(DEVICE_ID);
    expect(udpDeviceId("Solar-Inverter-02")).toMatch(/^[0-9a-f]{12}$/);
    expect(udpDeviceId("Solar-Inverter-02")).not.toBe(udpDeviceId("Solar-Inverter-03"));
    expect(udpClaimCode(DEVICE_ID)).toBe("D8C7E750");
  });
});

describe("приймач UDP", () => {
  let t: TestApp; let srv: ReturnType<typeof startUdpJsonServer>; let port: number;
  const client = dgram.createSocket("udp4");
  const send = (obj: unknown) => new Promise<void>((r, j) =>
    client.send(Buffer.from(JSON.stringify(obj)), port, "127.0.0.1", (e) => (e ? j(e) : r())));
  const settle = () => new Promise((r) => setTimeout(r, 250));

  beforeAll(async () => {
    t = await makeTestApp(); clearModelCache();
    const ingest = { db: t.db, store: t.store, publish: async () => {}, log: { info() {}, warn() {} }, minIntervalMs: 0 };
    srv = startUdpJsonServer({ db: t.db, ingest, log: ingest.log }, 0, "127.0.0.1");
    await new Promise<void>((r) => srv.sock.once("listening", () => r()));
    port = srv.sock.address().port;
  });
  afterAll(async () => { client.close(); await srv.close(); await t.close(); });

  it("перший пакет реєструє пристрій і пише метрики", async () => {
    await send(NIGHT);
    await settle();
    const [d] = await t.db.select().from(devices).where(eq(devices.id, DEVICE_ID));
    expect(d?.hw).toBe("esp32-udp");
    expect(d?.online).toBe(true);
    expect(d?.modelId).toBeNull();                 // карта регістрів тут ні до чого
    const rows = await t.db.select().from(telemetry).where(eq(telemetry.deviceId, DEVICE_ID));
    const m = new Map(rows.map((r) => [r.metric, r.value]));
    expect(m.get("load_w")).toBe(252);
    expect(m.get("bat_w")).toBeCloseTo(298.48, 2);
    expect(m.get("bat_soc")).toBe(92);
    const [st] = await t.db.select().from(deviceState).where(eq(deviceState.deviceId, DEVICE_ID));
    expect((st?.state as Record<string, number>).load_w).toBe(252);
    const snap = await t.store.get(DEVICE_ID);     // екран бере саме це
    expect(snap?.metrics.bat_soc).toBe(92);
  });

  it("у списку видно адресу і кількість пакетів", async () => {
    const [s] = srv.list();
    expect(s?.deviceId).toBe(DEVICE_ID);
    expect(s?.ip).toBe("127.0.0.1");
    expect(s?.packets).toBeGreaterThan(0);
    expect(s?.rejected).toBe(0);
    expect(s?.lastError).toBeNull();
  });

  it("сміття і завеликий пакет не валять приймач", async () => {
    await new Promise<void>((r, j) => client.send(Buffer.from("не json"), port, "127.0.0.1", (e) => (e ? j(e) : r())));
    await new Promise<void>((r, j) => client.send(Buffer.alloc(2000, 0x41), port, "127.0.0.1", (e) => (e ? j(e) : r())));
    await send({ device: "b0cbd8c7e750", load_w: 300 });
    await settle();
    const rows = await t.db.select().from(telemetry).where(eq(telemetry.deviceId, DEVICE_ID));
    expect(rows.some((r) => r.metric === "load_w" && r.value === 300)).toBe(true);
  });

  it("пакет за той самий пристрій з чужої адреси відкидається", async () => {
    const other = dgram.createSocket("udp4");
    try {
      await new Promise<void>((r) => other.bind(0, "127.0.0.2", () => r()));
      await new Promise<void>((r, j) => other.send(Buffer.from(JSON.stringify({ ...NIGHT, load_w: 9999 })), port, "127.0.0.1", (e) => (e ? j(e) : r())));
      await settle();
      const rows = await t.db.select().from(telemetry).where(eq(telemetry.deviceId, DEVICE_ID));
      expect(rows.some((r) => r.value === 9999)).toBe(false);
      const [s] = srv.list();
      expect(s?.rejected).toBe(1);
      expect(s?.lastError).toContain("127.0.0.2");
    } finally { other.close(); }
  });
});
