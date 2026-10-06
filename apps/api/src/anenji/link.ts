/**
 * Канал до інвертора через WiFi-логер, що сам підключився до нас (порт 8899).
 *
 * Логери бувають двох ґатунків, і наперед невідомо, який прийде:
 *   rtu — прозорий мост RS485↔TCP (Hi-Flying, USR, Elfin): у соціться голі кадри Modbus RTU;
 *   v5  — Solarman-обгортка (0xA5 … 0x15), той самий Modbus усередині кадру 0x4510/0x1510.
 * Тому перший запит вирішує: відповідь, що починається з 0xA5, означає v5, будь-яка інша — rtu.
 * Далі обгортка зафіксована і більше не вгадується.
 */
import type net from "node:net";
import { buildReadHolding, parseReadResponse, splitFrames } from "../solarman/client.ts";
import { buildResponse, CONTROL_NAMES, type V5Frame } from "../solarman/v5.ts";
import { buildRtuRead, parseRtuRead, rtuResponseLen, type RtuResult } from "./rtu.ts";

export type Framing = "rtu" | "v5";

/** Таймаут — окрема причина: по ній видно, що регістр глухий, а не що інвертор відмовив. */
export type ReadResult = RtuResult | { ok: false; reason: "timeout" };

export interface LinkLog { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void }

interface Pending {
  slave: number; count: number;
  resolve: (r: ReadResult) => void;
  timer: NodeJS.Timeout;
  seq: number;
}

/** Байти, які прийшли не у відповідь на наш запит: журнал протоколу. */
export type OnJunk = (buf: Buffer, kind: "rtu" | "v5", control?: number) => void;

export class AnenjiLink {
  framing: Framing | null = null;
  /** серійник логера з заголовка V5 (у прозорому мості його немає) */
  loggerSerial = 0;
  private sock: net.Socket;
  private log: LinkLog;
  private onJunk: OnJunk | undefined;
  private buf: Buffer = Buffer.alloc(0);
  private pending: Pending | null = null;
  private seq = Math.floor(Math.random() * 200) + 1;
  private ackSeq = 0;

  constructor(sock: net.Socket, log: LinkLog, onJunk?: OnJunk) {
    this.sock = sock; this.log = log; this.onJunk = onJunk;
    sock.on("data", (chunk) => this.onData(Buffer.from(chunk)));
  }

  /** Один запит на читання. Паралельних запитів немає: RS485 — одна лінія. */
  read(slave: number, start: number, count: number, timeoutMs: number, framing?: Framing): Promise<ReadResult> {
    if (this.pending) return Promise.resolve({ ok: false as const, reason: "bad" as const });
    const use = framing ?? this.framing ?? "rtu";
    this.seq = (this.seq + 1) & 0xff || 1;
    const seq = this.seq;
    return new Promise<ReadResult>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.seq === seq) { this.pending = null; resolve({ ok: false, reason: "timeout" }); }
      }, timeoutMs);
      this.pending = { slave, count, resolve, timer, seq };
      const req = use === "v5"
        ? buildReadHolding(this.loggerSerial, seq, start, count, slave)
        : buildRtuRead(slave, start, count);
      this.sock.write(req);
    });
  }

  private settle(r: ReadResult) {
    const p = this.pending;
    if (!p) return false;
    this.pending = null;
    clearTimeout(p.timer);
    p.resolve(r);
    return true;
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]) as Buffer;
    for (;;) {
      if (!this.buf.length) return;
      const asV5 = this.framing === "v5" || (this.framing === null && this.buf[0] === 0xa5);
      if (asV5) {
        const { frames, rest } = splitFrames(this.buf);
        const moved = rest.length !== this.buf.length;
        this.buf = rest as Buffer;
        for (const f of frames) this.deliverV5(f);
        if (!moved) break;
        continue;
      }
      const need = rtuResponseLen(this.buf);
      if (!need || this.buf.length < need) break;
      const frame = Buffer.from(this.buf.subarray(0, need));
      this.buf = Buffer.from(this.buf.subarray(need)) as Buffer;
      this.deliverRtu(frame);
    }
    // захист від сміття, що ніколи не складеться в кадр
    if (this.buf.length > 4096) this.buf = Buffer.alloc(0) as Buffer;
  }

  private deliverRtu(frame: Buffer) {
    const p = this.pending;
    if (!p) { this.onJunk?.(frame, "rtu"); return; }
    const r = parseRtuRead(frame, p.slave, p.count);
    if (!r.ok && r.reason === "bad") {
      // чужий або битий кадр: краще дочекатися свого, ніж віддати хибну помилку
      this.onJunk?.(frame, "rtu");
      return;
    }
    if (this.framing === null) { this.framing = "rtu"; this.log.info({ framing: "rtu" }, "anenji: прозорий Modbus RTU"); }
    this.settle(r);
  }

  private deliverV5(f: V5Frame) {
    if (f.serial) this.loggerSerial = f.serial;
    if (this.framing === null && f.control !== 0x1510) this.framing = "v5";   // логер сам показав обгортку
    if (f.control === 0x1510) {
      if (this.framing === null) { this.framing = "v5"; this.log.info({ framing: "v5", serial: f.serial }, "anenji: Solarman-обгортка"); }
      const p = this.pending;
      if (!p) { this.onJunk?.(f.raw, "v5", f.control); return; }
      this.settle(parseReadResponse(f, p.count));
      return;
    }
    // hello/heartbeat/data push: підтверджуємо, щоб логер не скидав зʼєднання, і журналюємо
    this.log.info({ control: f.control.toString(16), name: CONTROL_NAMES[f.control] ?? "?", serial: f.serial }, "anenji: кадр логера");
    this.onJunk?.(f.raw, "v5", f.control);
    if (f.control >= 0x4000 && f.control < 0x5000) {
      this.ackSeq = (this.ackSeq + 1) & 0xff;
      this.sock.write(buildResponse(f, this.ackSeq));
    }
  }

  stop() {
    this.settle({ ok: false, reason: "bad" });
  }
}
