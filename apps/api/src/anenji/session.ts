/**
 * Сесія з інвертором Anenji (перемаркований SRNE) через логер, що підключився до нас на 8899.
 *
 * 1) вгадуємо обгортку (прозорий RTU чи Solarman V5) і адресу в лінії RS485;
 * 2) читаємо серійник інвертора (0x0035, ASCII у молодших байтах) — це і є ідентичність пристрою,
 *    бо в прозорому мості немає ні серійника логера, ні claim-коду;
 * 3) цикл: діапазони з карти anenji-srne шматками по 16 регістрів -> payload як у плати -> інжест.
 *
 * SRNE вередливий: частина регістрів на конкретній моделі віддає виняток 0x02 (немає другого MPPT,
 * немає другої фази), а частина глухо таймаутить. Тому сесія вчиться: вкорочує читання до розміру,
 * який модель приймає, і більше не питає регістри, яких немає.
 */
import type net from "node:net";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { maps } from "@deye/register-maps";
import { devices, inverterModels } from "../db/schema.ts";
import { sha256, sha256hex } from "../lib/crypto.ts";
import { handleStatus, handleTelemetry, type IngestDeps } from "../mqtt/ingest.ts";
import { AnenjiLink, type Framing } from "./link.ts";
import { asciiLowByte } from "./rtu.ts";

export const ANENJI_MODEL_ID = "anenji-srne";
/** Якщо моделі ще немає в БД (свіжа база без seed) — беремо діапазони з самої карти. */
export const DEFAULT_RANGES = maps[ANENJI_MODEL_ID]!.pollRanges;

const REG_SN = 0x0035, SN_REGS = 20;
const REG_VERSIONS = 0x0014, REG_MACHINE_TYPE = 0x000b, REG_MODEL_CODE = 0x001b;
const REG_PROBE = 0x0100;              // SOC батареї: є на будь-якій моделі SRNE
const SLAVES = [1, 2, 3, 4, 5];
const CHUNK = 16;                      // SRNE гарантує лише 20 регістрів за раз, беремо з запасом
const GAP_MS = 50;                     // пауза між запитами: RS485 не любить щільних серій
const TIMEOUT_MS = 4000;
const PROBE_TIMEOUT_MS = 2500;
const MAX_SHRINK = 6;                  // стільки разів за цикл дозволено вкорочувати читання
const DEAD_LINK_TIMEOUTS = 3;          // стільки таймаутів підряд — вважаємо лінію мертвою
const HELLO_WAIT_MS = 800;             // даємо логеру сказати перше слово: по ньому видно обгортку

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Серійник інвертора -> id пристрою (12 hex, як у решти пристроїв) і claim-код з наліпки. */
export const anenjiDeviceId = (sn: string) => sha256hex(`anenji:${sn}`).slice(0, 12);
export const anenjiClaimCode = (sn: string) => sn.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-10);

export interface SessionDeps { db: PgDatabase<any, any, any>; ingest: IngestDeps; log: IngestDeps["log"]; intervalMs?: number; /** пауза між запитами в лінії RS485; у тестах 0 */ gapMs?: number }

export interface SessionInfo {
  ip: string; framing: Framing | null; slave: number; sn: string;
  deviceId: string; fw: string; polls: number; lastError: string | null; lastPollAt: string | null;
}

export class AnenjiSession {
  sn = "";
  deviceId = "";
  slave = 0;
  framing: Framing | null = null;
  polls = 0;
  lastError: string | null = null;
  lastPollAt: Date | null = null;
  private fw = "";
  private sock: net.Socket;
  private deps: SessionDeps;
  private link: AnenjiLink;
  private stopped = false;
  private pollSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private limit = new Map<number, number>();   // початок читання -> розмір, який модель приймає
  private dead = new Set<number>();            // регістри, яких на цій моделі немає
  private timeouts = 0;

  constructor(sock: net.Socket, deps: SessionDeps, link: AnenjiLink) {
    this.sock = sock; this.deps = deps; this.link = link;
    sock.on("close", () => this.stop("closed"));
    sock.on("error", (e) => this.stop(e.message));
  }

  get ip() { return this.sock.remoteAddress ?? ""; }

  info(): SessionInfo {
    return { ip: this.ip, framing: this.framing, slave: this.slave, sn: this.sn, deviceId: this.deviceId,
      fw: this.fw, polls: this.polls, lastError: this.lastError, lastPollAt: this.lastPollAt?.toISOString() ?? null };
  }

  /** Обгортка + адреса в лінії. Якщо логер уже показав себе кадром V5, з нього й починаємо. */
  private async negotiate(): Promise<boolean> {
    await sleep(HELLO_WAIT_MS);
    const order: Framing[] = this.link.framing ? [this.link.framing] : ["rtu", "v5"];
    // спершу обидві обгортки на адресі 1 (так налаштовані майже всі), і лише потім решта адрес
    const combos = [...order.map((framing) => ({ framing, slave: SLAVES[0]! })),
                    ...order.flatMap((framing) => SLAVES.slice(1).map((slave) => ({ framing, slave })))];
    for (const { framing, slave } of combos) {
      if (this.stopped) return false;
      const r = await this.link.read(slave, REG_PROBE, 1, PROBE_TIMEOUT_MS, framing);
      // виняток — теж відповідь: пристрій на лінії є, просто регістр йому не до душі
      if (r.ok || (!r.ok && r.reason === "exception")) {
        this.framing = framing; this.slave = slave;
        this.deps.log.info({ ip: this.ip, framing, slave, soc: r.ok ? r.regs[0] : null }, "anenji: інвертор відповів");
        return true;
      }
      await sleep(this.deps.gapMs ?? GAP_MS);
    }
    this.lastError = "ніхто не відповів на 0x0100";
    return false;
  }

  /** Серійник, версії прошивки, код моделі. Усе необовʼязкове: без них просто менше знаємо. */
  private async identify() {
    const sn: number[] = [];
    for (let off = 0; off < SN_REGS; off += CHUNK) {
      const r = await this.readChunk(REG_SN + off, Math.min(CHUNK, SN_REGS - off));
      if (!r) break;
      sn.push(...r);
    }
    this.sn = asciiLowByte(sn);
    const v = await this.readChunk(REG_VERSIONS, 4);
    const ver = (raw: number | undefined) => (raw === undefined ? "?" : `v${(raw / 100).toFixed(2)}`);
    if (v) this.fw = `cpu1 ${ver(v[0])} / cpu2 ${ver(v[1])}`;
    const t = await this.readChunk(REG_MACHINE_TYPE, 1);
    const mc = await this.readChunk(REG_MODEL_CODE, 1);
    this.deps.log.info({ ip: this.ip, sn: this.sn, fw: this.fw, machineType: t?.[0], modelCode: mc?.[0] }, "anenji: інвертор розпізнано");
  }

  async start(): Promise<boolean> {
    if (!(await this.negotiate())) { this.sock.destroy(); return false; }
    await this.identify();
    if (!this.sn) {
      // без серійника пристрій не має стабільної ідентичності — краще чесно не писати телеметрію
      this.lastError = "інвертор не віддав серійник (0x0035)";
      this.deps.log.warn({ ip: this.ip }, "anenji: немає серійника, телеметрію не пишемо");
      return false;
    }
    this.deviceId = anenjiDeviceId(this.sn);
    await this.ensureDevice();
    await handleStatus(this.deps.ingest, this.deviceId, "online");
    this.deps.log.info({ ip: this.ip, sn: this.sn, deviceId: this.deviceId, claimCode: anenjiClaimCode(this.sn) }, "anenji: сесія почалась");
    void this.loop();
    return true;
  }

  private async ensureDevice() {
    const [d] = await this.deps.db.select({ id: devices.id, modelId: devices.modelId }).from(devices).where(eq(devices.id, this.deviceId));
    if (!d) {
      await this.deps.db.insert(devices).values({
        id: this.deviceId, hw: "anenji", fw: this.fw || "srne", inverterSerial: this.sn,
        secretHash: "none", claimCodeHash: sha256(anenjiClaimCode(this.sn)),
        modelId: ANENJI_MODEL_ID, name: `Anenji ${this.sn.slice(-6)}`,
      }).onConflictDoNothing();
      return;
    }
    // карта в SRNE не визначається по регістрах, тому її ставимо ми
    if (!d.modelId) await this.deps.db.update(devices).set({ modelId: ANENJI_MODEL_ID }).where(eq(devices.id, this.deviceId));
    if (this.fw) await this.deps.db.update(devices).set({ fw: this.fw, inverterSerial: this.sn }).where(eq(devices.id, this.deviceId));
  }

  private async ranges(): Promise<[number, number][]> {
    const [d] = await this.deps.db.select({ modelId: devices.modelId }).from(devices).where(eq(devices.id, this.deviceId));
    if (!d?.modelId) return DEFAULT_RANGES;
    const [m] = await this.deps.db.select({ pollRanges: inverterModels.pollRanges }).from(inverterModels).where(eq(inverterModels.id, d.modelId));
    return (m?.pollRanges as [number, number][] | undefined) ?? DEFAULT_RANGES;
  }

  /**
   * Одне читання з навчанням: виняток на кілька регістрів означає, що модель не має хвоста блоку,
   * тому вкорочуємо запит і запамʼятовуємо розмір; виняток на один регістр — регістра просто немає.
   */
  private async readChunk(start: number, want: number, budget = { left: MAX_SHRINK }): Promise<number[] | null> {
    let count = Math.min(want, this.limit.get(start) ?? want);
    while (!this.stopped && count > 0) {
      await sleep(this.deps.gapMs ?? GAP_MS);
      const r = await this.link.read(this.slave, start, count, TIMEOUT_MS);
      if (r.ok) { this.limit.set(start, count); this.timeouts = 0; return r.regs; }
      if (r.reason === "exception") {
        if (count === 1) { this.dead.add(start); return null; }
        if (budget.left-- <= 0) return null;
        count = count - 1;
        this.limit.set(start, count);
        continue;
      }
      if (r.reason === "timeout") {
        this.timeouts++;
        this.lastError = `таймаут на 0x${start.toString(16)}`;
        return null;
      }
      this.lastError = `битий кадр на 0x${start.toString(16)}`;
      return null;
    }
    return null;
  }

  /** Сусідні шматки зливаємо в один діапазон: у payload їх не більше 16. */
  private static merge(parts: { start: number; regs: number[] }[]) {
    const out: { start: number; regs: number[] }[] = [];
    for (const p of parts) {
      const prev = out[out.length - 1];
      if (prev && prev.start + prev.regs.length === p.start) prev.regs.push(...p.regs);
      else out.push({ start: p.start, regs: [...p.regs] });
    }
    return out;
  }

  async pollOnce(): Promise<boolean> {
    const parts: { start: number; regs: number[] }[] = [];
    const budget = { left: MAX_SHRINK };
    for (const [lo, hi] of await this.ranges()) {
      for (let start = lo; start < hi && !this.stopped; ) {
        if (this.dead.has(start)) { start += 1; continue; }     // цього регістра на моделі немає
        const want = Math.min(CHUNK, hi - start);
        const regs = await this.readChunk(start, want, budget);
        if (regs) { parts.push({ start, regs }); start += regs.length; continue; }
        if (this.timeouts >= DEAD_LINK_TIMEOUTS) {
          this.deps.log.warn({ ip: this.ip, sn: this.sn }, "anenji: лінія не відповідає, рвемо зʼєднання");
          this.sock.destroy();
          return false;
        }
        start += this.dead.has(start) ? 1 : want;   // блок не читається — йдемо далі, не блокуючи решту
      }
    }
    const merged = AnenjiSession.merge(parts).slice(0, 16);
    if (!merged.length) return false;
    const payload = JSON.stringify({
      seq: ++this.pollSeq, ts: Math.floor(Date.now() / 1000), uptime: 0, stick: this.link.loggerSerial,
      ranges: merged.map((p) => ({ start: p.start, regs: p.regs.map((v) => (v & 0xffff).toString(16).padStart(4, "0")).join("") })),
    });
    const r = await handleTelemetry(this.deps.ingest, this.deviceId, payload);
    if (r.ok) { this.polls++; this.lastPollAt = new Date(); this.lastError = null; }
    else this.lastError = r.reason;
    return r.ok;
  }

  private async loop() {
    const interval = this.deps.intervalMs ?? 10_000;
    while (!this.stopped) {
      const t0 = Date.now();
      try { await this.pollOnce(); }
      catch (e) { this.lastError = String(e); this.deps.log.warn({ ip: this.ip, err: String(e) }, "anenji: помилка циклу"); }
      if (this.stopped) break;
      const wait = Math.max(1000, interval - (Date.now() - t0));
      await new Promise<void>((r) => { this.timer = setTimeout(r, wait); });
    }
  }

  stop(reason: string) {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.link.stop();
    if (this.deviceId) void handleStatus(this.deps.ingest, this.deviceId, "offline").catch(() => {});
    this.deps.log.info({ ip: this.ip, sn: this.sn, reason }, "anenji: сесія завершена");
  }
}
