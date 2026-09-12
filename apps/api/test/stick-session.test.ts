/**
 * Емуляція стіка в режимі TCP-Client: підключається до нашого сервера і відповідає на V5-запити
 * кадрами з реального дампу (spike/dumps). Перевіряємо probe серійника, створення пристрою, інжест.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { makeTestApp, type TestApp } from "./helpers.ts";
import { startLoggerServer } from "../src/solarman/server.ts";
import { splitFrames, buildReadHolding, modbusCrc, parseReadResponse } from "../src/solarman/client.ts";
import { clearModelCache } from "../src/mqtt/ingest.ts";
import { devices, telemetry } from "../src/db/schema.ts";

const dumpsDir = join(import.meta.dirname, "../../../spike/dumps");
const dump = JSON.parse(readFileSync(join(dumpsDir, readdirSync(dumpsDir).find((f) => f.endsWith(".json"))!), "utf8"));
const regs = new Map<number, number>(Object.entries<{ dec: number }>(dump.registers).map(([k, v]) => [Number(k), v.dec]));
const SERIAL = 2763543833;

/** Фейковий стік: на будь-який 0x4510 відповідає 0x1510 зі своїм серійником і регістрами з дампу. */
function fakeStickResponse(req: Buffer): Buffer {
  const f = splitFrames(req).frames[0]!;
  const mb = f.payload.subarray(15);
  const start = mb.readUInt16BE(2), count = mb.readUInt16BE(4);
  const have = Array.from({ length: count }, (_, i) => regs.get(start + i));
  let modbus: Buffer;
  if (have.every((v) => v !== undefined)) {
    modbus = Buffer.alloc(3 + count * 2 + 2); modbus[0] = 1; modbus[1] = 3; modbus[2] = count * 2;
    have.forEach((v, i) => modbus.writeUInt16BE(v!, 3 + 2 * i));
  } else { modbus = Buffer.alloc(5); modbus[0] = 1; modbus[1] = 0x83; modbus[2] = 2; }
  modbus.writeUInt16LE(modbusCrc(modbus.subarray(0, modbus.length - 2)), modbus.length - 2);
  const payload = Buffer.concat([Buffer.from([0x02, 0x01]), Buffer.alloc(12), modbus]);
  const out = Buffer.alloc(11 + payload.length + 2);
  out[0] = 0xa5; out.writeUInt16LE(payload.length, 1); out.writeUInt16LE(0x1510, 3); out[5] = f.seq; out[6] = 0x42; out.writeUInt32LE(SERIAL, 7);
  payload.copy(out, 11);
  let sum = 0; for (let i = 1; i < out.length - 2; i++) sum += out[i]!;
  out[out.length - 2] = sum & 0xff; out[out.length - 1] = 0x15;
  return out;
}

describe("v5 client framing", () => {
  it("запит збігається з реальним кадром прошивки", () => {
    const f = dump.frames[0];
    const req = buildReadHolding(SERIAL, 0x72, 0, 60);
    expect(req.toString("hex")).toBe(f.request);
  });
  it("відповідь з дампу парситься", () => {
    const f = splitFrames(Buffer.from(dump.frames[0].response, "hex")).frames[0]!;
    const r = parseReadResponse(f, 60);
    expect(r.ok && r.regs[0]).toBe(6);
  });
});

describe("стік у режимі TCP-Client", () => {
  let t: TestApp; let srv: ReturnType<typeof startLoggerServer>; let port: number; let stick: net.Socket;
  const published: string[] = [];
  beforeAll(async () => {
    t = await makeTestApp(); clearModelCache();
    const ingest = { db: t.db, store: t.store, publish: async (topic: string) => { published.push(topic); }, log: { info() {}, warn() {} }, minIntervalMs: 0 };
    srv = startLoggerServer({ db: t.db, ingest, log: ingest.log, intervalMs: 300 }, 0, "127.0.0.1");
    await new Promise<void>((r) => srv.server.once("listening", () => r()));
    port = (srv.server.address() as net.AddressInfo).port;
  });
  afterAll(async () => { stick?.destroy(); srv.server.close(); await t.close(); });

  it("probe серійника, пристрій створено, телеметрія і модель — за 2 цикли", async () => {
    stick = net.connect(port, "127.0.0.1");
    stick.on("data", (d) => { let b = Buffer.from(d); for (const f of splitFrames(b).frames) stick.write(fakeStickResponse(f.raw)); });
    await new Promise((r) => setTimeout(r, 1500));
    const [d] = await t.db.select().from(devices).where(eq(devices.id, "002763543833"));
    expect(d).toBeDefined();
    expect(d!.hw).toBe("stick"); expect(d!.stickSerial).toBe(SERIAL); expect(d!.online).toBe(true);
    expect(d!.modelId).toBe("deye-hp3"); expect(d!.inverterSerial).toBe("2309208317");
    const rows = await t.db.select().from(telemetry);
    expect(rows.length).toBeGreaterThan(50);
    const s = await t.store.get("002763543833");
    expect(s?.metrics.load_w).toBe(5582);
    expect(published).toContain("devices/002763543833/cfg");
  });

  it("claim стіка за серійником; секрет для MQTT не працює", async () => {
    const { signUp, api } = await import("./helpers.ts");
    const o = await signUp(t.app, "o@example.com"); const owner = api(t.app, o.cookie);
    const orgId = (await owner.post("/api/orgs", { name: "O" })).json().id;
    const r = await owner.post(`/api/orgs/${orgId}/devices/claim`, { code: String(SERIAL) });
    expect(r.statusCode).toBe(201);
    expect((await t.app.inject({ method: "POST", url: "/internal/mqtt/auth", payload: { username: "002763543833", password: "none" } })).statusCode).toBe(401);
  });

  it("розрив зʼєднання -> офлайн", async () => {
    stick.destroy();
    await new Promise((r) => setTimeout(r, 300));
    const [d] = await t.db.select().from(devices).where(eq(devices.id, "002763543833"));
    expect(d!.online).toBe(false);
  });
});
