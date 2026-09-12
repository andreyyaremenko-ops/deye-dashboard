/**
 * Сесія зі стіком у режимі TCP-Client: стік підключився, ми опитуємо.
 * 1) probe з серійником 0 -> справжній серійник із заголовка відповіді;
 * 2) пристрій "00<serial>" (12 hex-символів), claim-код = серійник;
 * 3) цикл: діапазони з моделі (або стартові) шматками по 60 -> payload як у плати -> інжест.
 */
import type net from "node:net";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { devices, inverterModels } from "../db/schema.ts";
import { sha256 } from "../lib/crypto.ts";
import { handleStatus, handleTelemetry, type IngestDeps } from "../mqtt/ingest.ts";
import { buildReadHolding, parseReadResponse, splitFrames } from "./client.ts";
import type { V5Frame } from "./v5.ts";

export const DEFAULT_RANGES: [number, number][] = [[0, 22], [500, 700]];
const CHUNK = 60;
const RESPONSE_TIMEOUT_MS = 6000;

export const stickDeviceId = (serial: number) => String(serial).padStart(12, "0").slice(-12);

export interface SessionDeps { db: PgDatabase<any, any, any>; ingest: IngestDeps; log: IngestDeps["log"]; intervalMs?: number }

export class StickSession {
  serial = 0;
  deviceId = "";
  private seq = Math.floor(Math.random() * 200) + 1;
  private buf: Buffer = Buffer.alloc(0);
  private waiter: { seq: number; resolve: (f: V5Frame) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null;
  private stopped = false;
  private pollSeq = 0;
  private timer: NodeJS.Timeout | null = null;
  private sock: net.Socket;
  private deps: SessionDeps;
  private onFrame: ((f: V5Frame) => void) | undefined;

  constructor(sock: net.Socket, deps: SessionDeps, onFrame?: (f: V5Frame) => void) {
    this.sock = sock; this.deps = deps; this.onFrame = onFrame;
    sock.on("data", (chunk) => this.onData(chunk));
    sock.on("close", () => this.stop("closed"));
    sock.on("error", (e) => this.stop(e.message));
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]) as Buffer;
    const { frames, rest } = splitFrames(this.buf);
    this.buf = rest as Buffer;
    for (const f of frames) {
      if (f.control === 0x1510 && this.waiter && f.seq === this.waiter.seq) {
        const w = this.waiter; this.waiter = null; clearTimeout(w.timer); w.resolve(f);
      } else {
        this.onFrame?.(f); // heartbeat/hello тощо — у logger_frames
      }
    }
    if (this.buf.length > 4096) this.buf = Buffer.alloc(0) as Buffer;
  }

  private request(serial: number, start: number, count: number): Promise<V5Frame> {
    if (this.waiter) return Promise.reject(new Error("busy"));
    this.seq = (this.seq + 1) & 0xff || 1;
    const seq = this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.waiter?.seq === seq) { this.waiter = null; reject(new Error("timeout")); } }, RESPONSE_TIMEOUT_MS);
      this.waiter = { seq, resolve, reject, timer };
      this.sock.write(buildReadHolding(serial, seq, start, count));
    });
  }

  /** Крок 1: серійник. Стік відповідає на будь-який серійник своїм у заголовку. */
  async start(): Promise<boolean> {
    try {
      const f = await this.request(0, 0, 1);
      this.serial = f.serial;
    } catch (e) {
      this.deps.log.warn({ err: String(e) }, "stick: probe failed");
      this.sock.destroy(); return false;
    }
    this.deviceId = stickDeviceId(this.serial);
    await this.ensureDevice();
    await handleStatus(this.deps.ingest, this.deviceId, "online");
    this.deps.log.info({ serial: this.serial, deviceId: this.deviceId }, "stick: session started");
    void this.loop();
    return true;
  }

  private async ensureDevice() {
    const [d] = await this.deps.db.select({ id: devices.id }).from(devices).where(eq(devices.id, this.deviceId));
    if (d) return;
    await this.deps.db.insert(devices).values({
      id: this.deviceId, hw: "stick", fw: "tcp-client", stickSerial: this.serial,
      secretHash: "none", claimCodeHash: sha256(String(this.serial)), name: `Стік ${this.serial}`,
    }).onConflictDoNothing();
  }

  private async ranges(): Promise<[number, number][]> {
    const [d] = await this.deps.db.select({ modelId: devices.modelId }).from(devices).where(eq(devices.id, this.deviceId));
    if (!d?.modelId) return DEFAULT_RANGES;
    const [m] = await this.deps.db.select({ pollRanges: inverterModels.pollRanges }).from(inverterModels).where(eq(inverterModels.id, d.modelId));
    return (m?.pollRanges as [number, number][] | undefined) ?? DEFAULT_RANGES;
  }

  /** Один цикл опитування -> payload як у прошивки -> handleTelemetry. */
  async pollOnce(): Promise<boolean> {
    const out: { start: number; regs: string }[] = [];
    for (const [lo, hi] of await this.ranges()) {
      for (let start = lo; start < hi; ) {
        const count = Math.min(CHUNK, hi - start);
        let f: V5Frame;
        try { f = await this.request(this.serial, start, count); }
        catch (e) { this.deps.log.warn({ serial: this.serial, start, err: String(e) }, "stick: read failed"); return out.length > 0 && this.flush(out); }
        const r = parseReadResponse(f, count);
        if (!r.ok) { if (r.reason === "exception") break; this.deps.log.warn({ serial: this.serial, start }, "stick: bad response"); break; }
        out.push({ start, regs: r.regs.map((v: number) => v.toString(16).padStart(4, "0")).join("") });
        start += count;
      }
    }
    return this.flush(out);
  }

  private async flush(ranges: { start: number; regs: string }[]) {
    if (!ranges.length) return false;
    const payload = JSON.stringify({ seq: ++this.pollSeq, ts: Math.floor(Date.now() / 1000), uptime: 0, stick: this.serial, ranges });
    const r = await handleTelemetry(this.deps.ingest, this.deviceId, payload);
    return r.ok;
  }

  private async loop() {
    const interval = this.deps.intervalMs ?? 10_000;
    while (!this.stopped) {
      const t0 = Date.now();
      try { await this.pollOnce(); } catch (e) { this.deps.log.warn({ err: String(e) }, "stick: poll error"); }
      const wait = Math.max(1000, interval - (Date.now() - t0));
      await new Promise<void>((r) => { this.timer = setTimeout(r, wait); });
    }
  }

  stop(reason: string) {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.waiter) { clearTimeout(this.waiter.timer); this.waiter.reject(new Error(reason)); this.waiter = null; }
    if (this.deviceId) void handleStatus(this.deps.ingest, this.deviceId, "offline").catch(() => {});
    this.deps.log.info({ serial: this.serial, reason }, "stick: session ended");
  }
}
