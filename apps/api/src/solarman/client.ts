/**
 * V5 запити (сервер -> стік) і розбір відповідей. Дзеркало firmware/src/solarman_v5.cpp.
 */
import { splitFrames, type V5Frame } from "./v5.ts";

export function modbusCrc(data: Buffer): number {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** Повний V5-кадр 0x4510 з Modbus 0x03 read holding. seq — один байт. */
export function buildReadHolding(loggerSerial: number, seq: number, start: number, count: number, slave = 1): Buffer {
  const mb = Buffer.alloc(8);
  mb[0] = slave; mb[1] = 0x03; mb.writeUInt16BE(start, 2); mb.writeUInt16BE(count, 4); mb.writeUInt16LE(modbusCrc(mb.subarray(0, 6)), 6);
  const payload = Buffer.concat([Buffer.from([0x02, 0x00, 0x00]), Buffer.alloc(12), mb]);
  const out = Buffer.alloc(11 + payload.length + 2);
  out[0] = 0xa5; out.writeUInt16LE(payload.length, 1); out.writeUInt16LE(0x4510, 3);
  out[5] = seq & 0xff; out[6] = 0; out.writeUInt32LE(loggerSerial >>> 0, 7);
  payload.copy(out, 11);
  let sum = 0; for (let i = 1; i < out.length - 2; i++) sum += out[i]!;
  out[out.length - 2] = sum & 0xff; out[out.length - 1] = 0x15;
  return out;
}

export type ReadResult = { ok: true; regs: number[] } | { ok: false; reason: "exception" | "bad"; code?: number };

/** Modbus з відповіді 0x1510: payload = type(1) status(1) 3×time(4) modbus(...) */
export function parseReadResponse(f: V5Frame, expectedCount: number): ReadResult {
  const mb = f.payload.subarray(14);
  if (mb.length < 5) return { ok: false, reason: "bad" };
  if (modbusCrc(mb.subarray(0, mb.length - 2)) !== mb.readUInt16LE(mb.length - 2)) return { ok: false, reason: "bad" };
  if (mb[1]! & 0x80) return { ok: false, reason: "exception", code: mb[2] };
  if (mb[1] !== 0x03 || mb[2] !== expectedCount * 2 || mb.length !== 3 + expectedCount * 2 + 2) return { ok: false, reason: "bad" };
  const regs: number[] = [];
  for (let i = 0; i < expectedCount; i++) regs.push(mb.readUInt16BE(3 + 2 * i));
  return { ok: true, regs };
}

export { splitFrames };
