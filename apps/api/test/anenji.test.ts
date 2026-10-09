/**
 * Емуляція інвертора Anenji (SRNE) за WiFi-логером, який підключається до нас на 8899.
 * Перевіряємо обидві обгортки (прозорий Modbus RTU і Solarman V5), навчання на винятках
 * (модель без другого MPPT), створення пристрою за серійником інвертора і сам інжест.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { and, eq } from "drizzle-orm";
import { makeTestApp, type TestApp } from "./helpers.ts";
import { startAnenjiServer } from "../src/anenji/server.ts";
import { anenjiClaimCode, anenjiDeviceId, ANENJI_MODEL_ID } from "../src/anenji/session.ts";
import { asciiLowByte, buildMbapException, buildMbapRead, buildMbapReadReply, buildRtuException, buildRtuRead, buildRtuReadReply,
  mbapResponseLen, parseMbapRead, parseRtuRead, rtuResponseLen } from "../src/anenji/rtu.ts";
import { clearModelCache } from "../src/mqtt/ingest.ts";
import { modbusCrc, splitFrames } from "../src/solarman/client.ts";
import { devices, loggerFrames, telemetry } from "../src/db/schema.ts";

const SN = "ANJ2602260356-100132";
const SLAVE = 1;
/** Однофазний 6.2 кВт на мережі: заряджає батарею, навантаження 450 Вт, один MPPT. */
const REGS = new Map<number, number>([
  [0x0014, 900], [0x0015, 104], [0x0016, 100], [0x0017, 100],
  [0x000b, 4], [0x001b, 62],
  [0x0100, 64], [0x0101, 512], [0x0102, 150], [0x0103, 0x1618],
  [0x0104, 0], [0x0105, 0], [0x0106, 0],
  [0x0107, 3521], [0x0108, 52], [0x0109, 1830], [0x010a, 0], [0x010b, 1], [0x010c, 0], [0x010d, 0], [0x010e, 768],
  [0x0210, 4],
  [0x0212, 3920], [0x0213, 2301], [0x0214, 73], [0x0215, 4998], [0x0216, 2298], [0x0217, 0],
  [0x0218, 5000], [0x0219, 20], [0x021a, 96], [0x021b, 450], [0x021c, 470], [0x021d, 0], [0x021e, 150], [0x021f, 7],
  [0x0220, 0xffec], [0x0221, 385], [0x0222, 402], [0x0223, 0], [0x0224, 0], [0x0225, 0],
  [0xf02d, 12], [0xf02e, 9], [0xf02f, 128], [0xf030, 94], [0xf031, 311],
  [0xf038, 1], [0xf039, 0x1a90], [0xf03a, 0], [0xf03b, 0x30d4], [0xf03c, 4], [0xf03d, 31],
  [0xf046, 0], [0xf047, 0x0bb8], [0xf048, 0], [0xf049, 0x1f40],
]);
for (let i = 0; i < SN.length; i++) REGS.set(0x0035 + i, SN.charCodeAt(i));
for (let i = SN.length; i < 20; i++) REGS.set(0x0035 + i, 0x20);
/** Другого MPPT і другої фази в цій моделі немає: вона відповідає винятком 0x02. */
const ABSENT = (reg: number) => (reg >= 0x010f && reg <= 0x0111) || (reg >= 0x022a && reg <= 0x0237);

/** Відповідь інвертора на RTU-запит: або регістри, або виняток, якщо хоч один регістр відсутній. */
function answer(req: Buffer): Buffer | null {
  if (req.length < 8 || req[0] !== SLAVE) return null;               // чужа адреса в лінії — тиша
  const start = req.readUInt16BE(2), count = req.readUInt16BE(4);
  const want = Array.from({ length: count }, (_, i) => start + i);
  if (want.some(ABSENT)) return buildRtuException(SLAVE, 0x02);
  if (want.some((r) => !REGS.has(r))) return buildRtuException(SLAVE, 0x02);
  return buildRtuReadReply(SLAVE, want.map((r) => REGS.get(r)!));
}

/** Те саме, але кадром MBAP: так відповідає мост у режимі шлюзу Modbus TCP ⇄ RTU. */
function answerMbap(req: Buffer): Buffer | null {
  if (req.length < 12 || req.readUInt16BE(2) !== 0) return null;
  const txid = req.readUInt16BE(0), unit = req[6]!;
  if (unit !== SLAVE) return null;
  const start = req.readUInt16BE(8), count = req.readUInt16BE(10);
  const want = Array.from({ length: count }, (_, i) => start + i);
  if (want.some(ABSENT) || want.some((r) => !REGS.has(r))) return buildMbapException(unit, 0x02, txid);
  return buildMbapReadReply(unit, want.map((r) => REGS.get(r)!), txid);
}

/** Обгортка Solarman V5 над відповіддю: так робить логер типу LSW-3. */
const V5_SERIAL = 1234567890;
function wrapV5(mb: Buffer, seq: number): Buffer {
  const payload = Buffer.concat([Buffer.from([0x02, 0x01]), Buffer.alloc(12), mb]);
  const out = Buffer.alloc(11 + payload.length + 2);
  out[0] = 0xa5; out.writeUInt16LE(payload.length, 1); out.writeUInt16LE(0x1510, 3);
  out[5] = seq; out[6] = 0x42; out.writeUInt32LE(V5_SERIAL, 7);
  payload.copy(out, 11);
  let sum = 0; for (let i = 1; i < out.length - 2; i++) sum += out[i]!;
  out[out.length - 2] = sum & 0xff; out[out.length - 1] = 0x15;
  return out;
}
function helloV5(): Buffer {
  const payload = Buffer.alloc(10); payload[0] = 0x02;
  const out = Buffer.alloc(11 + payload.length + 2);
  out[0] = 0xa5; out.writeUInt16LE(payload.length, 1); out.writeUInt16LE(0x4110, 3);
  out[5] = 1; out[6] = 0; out.writeUInt32LE(V5_SERIAL, 7);
  payload.copy(out, 11);
  let sum = 0; for (let i = 1; i < out.length - 2; i++) sum += out[i]!;
  out[out.length - 2] = sum & 0xff; out[out.length - 1] = 0x15;
  return out;
}

describe("Modbus RTU", () => {
  it("запит і відповідь складаються і розбираються", () => {
    const req = buildRtuRead(1, 0x0100, 18);
    expect(req.length).toBe(8);
    expect(req.subarray(0, 6).toString("hex")).toBe("010301000012");   // адреса 1, функція 3, з 0x0100, 18 регістрів
    expect(req.readUInt16LE(6)).toBe(modbusCrc(req.subarray(0, 6)));
    const rep = buildRtuReadReply(1, [64, 512, 150]);
    expect(rtuResponseLen(rep)).toBe(rep.length);
    const r = parseRtuRead(rep, 1, 3);
    expect(r.ok && r.regs).toEqual([64, 512, 150]);
  });
  it("виняток, чужа адреса і бита контрольна сума — різні причини", () => {
    const exc = buildRtuException(1, 0x02);
    expect(rtuResponseLen(exc)).toBe(5);
    expect(parseRtuRead(exc, 1, 3)).toEqual({ ok: false, reason: "exception", code: 2 });
    const rep = buildRtuReadReply(1, [1]);
    expect(parseRtuRead(rep, 2, 1)).toEqual({ ok: false, reason: "bad" });
    const broken = Buffer.from(rep); broken[3] = (broken[3] ?? 0) ^ 0xff;
    expect(parseRtuRead(broken, 1, 1)).toEqual({ ok: false, reason: "bad" });
  });
  it("довжина кадру по потоку, доки байтів мало — 0", () => {
    expect(rtuResponseLen(Buffer.from([1, 3]))).toBe(0);
    expect(rtuResponseLen(Buffer.from([1, 3, 6]))).toBe(11);
  });
  it("MBAP: заголовок без CRC, виняток і чужий protocol id", () => {
    const req = buildMbapRead(1, 0x0100, 18, 0x1234);
    expect(req.toString("hex")).toBe("123400000006010301000012");   // txid, protocol id 0, довжина 6
    const rep = buildMbapReadReply(1, [64, 512, 150], 0x1234);
    expect(mbapResponseLen(rep)).toBe(rep.length);
    expect(parseMbapRead(rep, 1, 3)).toEqual({ ok: true, regs: [64, 512, 150] });
    expect(parseMbapRead(buildMbapException(1, 2, 0x1234), 1, 3)).toEqual({ ok: false, reason: "exception", code: 2 });
    const wrong = Buffer.from(rep); wrong.writeUInt16BE(1, 2);
    expect(parseMbapRead(wrong, 1, 3)).toEqual({ ok: false, reason: "bad" });
    // голий RTU, прочитаний як MBAP, саме на цьому й спотикається: protocol id = 0x0100
    expect(buildRtuRead(1, 0x0100, 1).readUInt16BE(2)).not.toBe(0);
  });
  it("серійник SRNE — ASCII в молодших байтах", () => {
    const regs = [...SN].map((c) => 0xff00 | c.charCodeAt(0));
    expect(asciiLowByte([...regs, 0x20, 0x00])).toBe(SN);
  });
});

/** Піднімає сервер і підключає до нього фейковий логер у заданій обгортці. */
async function connectFake(t: TestApp, framing: "rtu" | "v5" | "mtcp", strict = false) {
  const published: string[] = [];
  const ingest = { db: t.db, store: t.store, publish: async (topic: string) => { published.push(topic); }, log: { info() {}, warn() {} }, minIntervalMs: 0 };
  const srv = startAnenjiServer({ db: t.db, ingest, log: ingest.log, intervalMs: 200, gapMs: 0, probeMs: 300 }, 0, "127.0.0.1");
  await new Promise<void>((r) => srv.server.once("listening", () => r()));
  const port = (srv.server.address() as net.AddressInfo).port;
  const sock = net.connect(port, "127.0.0.1");
  await new Promise<void>((r) => sock.once("connect", () => r()));
  if (framing === "v5") sock.write(helloV5());
  let buf = Buffer.alloc(0);
  let closedBy = "";
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (framing === "mtcp") {
      while (buf.length >= 12) {
        const req = Buffer.from(buf.subarray(0, 12)); buf = Buffer.from(buf.subarray(12));
        // справжній шлюз на кадр із protocol id ≠ 0 (тобто на голий RTU) рве зʼєднання
        if (strict && req.readUInt16BE(2) !== 0) { closedBy = "protocol id"; sock.destroy(); return; }
        const rep = answerMbap(req);
        if (rep) sock.write(rep);
      }
      return;
    }
    if (framing === "rtu") {
      // як справжній інвертор у лінії: кадр без правильної CRC (наприклад проба MBAP,
      // яку прозорий мост просто пересилає) відкидається побайтово
      while (buf.length >= 8) {
        const cand = buf.subarray(0, 8);
        if (modbusCrc(cand.subarray(0, 6)) !== cand.readUInt16LE(6)) { buf = buf.subarray(1); continue; }
        buf = buf.subarray(8);
        const rep = answer(Buffer.from(cand));
        if (rep) sock.write(rep);
      }
      return;
    }
    const { frames, rest } = splitFrames(buf); buf = Buffer.from(rest);
    for (const f of frames) {
      if (f.control !== 0x4510) continue;                      // 0x1110 — підтвердження нашого hello
      const rep = answer(Buffer.from(f.payload.subarray(15)));
      if (rep) sock.write(wrapV5(rep, f.seq));
    }
  });
  return { srv, sock, port, published, closedBy: () => closedBy };
}

const metricsOf = async (t: TestApp, deviceId: string) => {
  const rows = await t.db.select({ metric: telemetry.metric, value: telemetry.value }).from(telemetry).where(eq(telemetry.deviceId, deviceId));
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.metric, r.value);   // останнє значення перекриває попередні — вони однакові
  return m;
};

describe("Anenji за прозорим логером (Modbus RTU)", () => {
  let t: TestApp; let f: Awaited<ReturnType<typeof connectFake>>;
  const deviceId = anenjiDeviceId(SN);
  beforeAll(async () => {
    t = await makeTestApp(); clearModelCache();
    f = await connectFake(t, "rtu");
    await new Promise((r) => setTimeout(r, 2500));
  });
  afterAll(async () => { f.sock.destroy(); f.srv.server.close(); await t.close(); });

  it("обгортку і адресу в лінії знайдено, інвертор розпізнано за серійником", () => {
    const [s] = f.srv.list();
    expect(s?.framing).toBe("rtu");
    expect(s?.slave).toBe(1);
    expect(s?.sn).toBe(SN);
    expect(s?.fw).toBe("cpu1 v9.00 / cpu2 v1.04");
    expect(s?.polls).toBeGreaterThan(0);
    expect(s?.lastError).toBeNull();
  });

  it("пристрій створено з картою anenji-srne і claim-кодом із наліпки", async () => {
    const [d] = await t.db.select().from(devices).where(eq(devices.id, deviceId));
    expect(d?.modelId).toBe(ANENJI_MODEL_ID);
    expect(d?.hw).toBe("anenji");
    expect(d?.inverterSerial).toBe(SN);
    expect(d?.online).toBe(true);
    expect(anenjiClaimCode(SN)).toBe("0356100132");
  });

  it("метрики розібрані: заряд батареї — мінус, мережа і PV на місці", async () => {
    const m = await metricsOf(t, deviceId);
    expect(m.get("bat_soc")).toBe(64);
    expect(m.get("bat_v")).toBe(51.2);
    expect(m.get("bat_a")).toBe(-15);
    expect(m.get("bat_w")).toBe(-768);
    expect(m.get("pv1_w")).toBe(1830);
    expect(m.get("pv_w")).toBeUndefined();              // другого MPPT немає, тому суми немає
    expect(m.get("load_w")).toBe(450);
    expect(m.get("grid_w")).toBeCloseTo(1679.7, 1);
    expect(m.get("pv_day_kwh")).toBe(12.8);
    expect(m.get("pv_total_kwh")).toBe(7233.6);
    expect(m.get("temp_heatsink_c")).toBe(38.5);
  });

  it("на винятку читання вкорочується, а не губить увесь блок", async () => {
    const m = await metricsOf(t, deviceId);
    // 0x010F..0x0111 відсутні, але батарея і перший MPPT з того ж блоку прочитані
    expect(m.get("pv2_w")).toBeUndefined();
    expect(m.get("pv1_v")).toBe(352.1);
    expect(m.get("bat_charge_w")).toBe(768);
  });

  it("повторне підключення того самого інвертора не множить пристрої", async () => {
    const g = await connectFake(t, "rtu");
    try {
      await new Promise((r) => setTimeout(r, 2200));
      const rows = await t.db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId));
      expect(rows.length).toBe(1);
    } finally { g.sock.destroy(); g.srv.server.close(); }
  });
});

describe("Anenji за логером з обгорткою Solarman V5", () => {
  let t: TestApp; let f: Awaited<ReturnType<typeof connectFake>>;
  const deviceId = anenjiDeviceId(SN);
  beforeAll(async () => {
    t = await makeTestApp(); clearModelCache();
    f = await connectFake(t, "v5");
    await new Promise((r) => setTimeout(r, 2500));
  });
  afterAll(async () => { f.sock.destroy(); f.srv.server.close(); await t.close(); });

  it("обгортку взято з кадру логера, серійник логера запамʼятано", () => {
    const [s] = f.srv.list();
    expect(s?.framing).toBe("v5");
    expect(s?.sn).toBe(SN);
    expect(s?.polls).toBeGreaterThan(0);
  });

  it("телеметрія така сама, як через прозорий мост", async () => {
    const m = await metricsOf(t, deviceId);
    expect(m.get("bat_w")).toBe(-768);
    expect(m.get("load_w")).toBe(450);
    expect(m.get("grid_hz")).toBe(49.98);
  });

  it("кадр логера збережено в logger_frames для аналізу протоколу", async () => {
    const rows = await t.db.select().from(loggerFrames).where(and(eq(loggerFrames.serial, V5_SERIAL), eq(loggerFrames.control, 0x4110)));
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("Anenji за мостом у режимі шлюзу Modbus TCP", () => {
  let t: TestApp; let f: Awaited<ReturnType<typeof connectFake>>;
  const deviceId = anenjiDeviceId(SN);
  beforeAll(async () => {
    t = await makeTestApp(); clearModelCache();
    f = await connectFake(t, "mtcp", true);   // strict: рве зʼєднання на голому RTU
    await new Promise((r) => setTimeout(r, 2500));
  });
  afterAll(async () => { f.sock.destroy(); f.srv.server.close(); await t.close(); });

  it("обгортку MBAP знайдено з першої проби, зʼєднання не обірвано", () => {
    const [s] = f.srv.list();
    expect(s?.framing).toBe("mtcp");
    expect(s?.slave).toBe(1);
    expect(s?.sn).toBe(SN);
    expect(s?.polls).toBeGreaterThan(0);
    expect(f.closedBy()).toBe("");            // голий RTU ми так і не надіслали
  });

  it("телеметрія така сама, як через прозорий мост", async () => {
    const m = await metricsOf(t, deviceId);
    expect(m.get("bat_w")).toBe(-768);
    expect(m.get("load_w")).toBe(450);
    expect(m.get("grid_w")).toBeCloseTo(1679.7, 1);
    expect(m.get("pv_total_kwh")).toBe(7233.6);
  });
});
