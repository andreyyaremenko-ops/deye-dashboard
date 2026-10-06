/**
 * Modbus RTU «як є»: прозорий WiFi-логер (порт 8899) віддає байти з RS485 без жодної обгортки,
 * тому ми самі і майстер, і той, хто збирає кадри з потоку.
 *
 * Запит:    slave func startHi startLo cntHi cntLo crcLo crcHi
 * Відповідь: slave func байтів дані... crcLo crcHi
 * Виняток:   slave func|0x80 код crcLo crcHi
 */
import { modbusCrc } from "../solarman/client.ts";

/** Читання holding-регістрів (0x03); SRNE віддає все саме цією функцією. */
export const FUNC_READ_HOLDING = 0x03;

export function buildRtuRead(slave: number, start: number, count: number, func = FUNC_READ_HOLDING): Buffer {
  const out = Buffer.alloc(8);
  out[0] = slave; out[1] = func;
  out.writeUInt16BE(start & 0xffff, 2);
  out.writeUInt16BE(count, 4);
  out.writeUInt16LE(modbusCrc(out.subarray(0, 6)), 6);
  return out;
}

/**
 * Скільки байтів у кадрі на початку буфера. 0 — даних ще мало, щоб сказати.
 * Довжина RTU не передається в кадрі, її дає функція: виняток завжди 5 байтів,
 * відповідь на 0x03 — 3 + байтів даних + 2.
 */
export function rtuResponseLen(buf: Buffer): number {
  if (buf.length < 3) return 0;
  if (buf[1]! & 0x80) return 5;
  return 3 + buf[2]! + 2;
}

export type RtuResult =
  | { ok: true; regs: number[] }
  | { ok: false; reason: "exception" | "bad"; code?: number };

export function parseRtuRead(frame: Buffer, slave: number, count: number): RtuResult {
  if (frame.length < 5) return { ok: false, reason: "bad" };
  if (modbusCrc(frame.subarray(0, frame.length - 2)) !== frame.readUInt16LE(frame.length - 2)) return { ok: false, reason: "bad" };
  if (frame[0] !== slave) return { ok: false, reason: "bad" };
  if (frame[1]! & 0x80) return { ok: false, reason: "exception", code: frame[2] };
  if (frame[1] !== FUNC_READ_HOLDING || frame[2] !== count * 2 || frame.length !== 3 + count * 2 + 2) return { ok: false, reason: "bad" };
  const regs: number[] = [];
  for (let i = 0; i < count; i++) regs.push(frame.readUInt16BE(3 + 2 * i));
  return { ok: true, regs };
}

/** Відповідь інвертора на наш запит — для тестів і для фейкового інвертора. */
export function buildRtuReadReply(slave: number, regs: number[]): Buffer {
  const out = Buffer.alloc(3 + regs.length * 2 + 2);
  out[0] = slave; out[1] = FUNC_READ_HOLDING; out[2] = regs.length * 2;
  regs.forEach((v, i) => out.writeUInt16BE(v & 0xffff, 3 + 2 * i));
  out.writeUInt16LE(modbusCrc(out.subarray(0, out.length - 2)), out.length - 2);
  return out;
}

export function buildRtuException(slave: number, code: number, func = FUNC_READ_HOLDING): Buffer {
  const out = Buffer.alloc(5);
  out[0] = slave; out[1] = func | 0x80; out[2] = code;
  out.writeUInt16LE(modbusCrc(out.subarray(0, 3)), 3);
  return out;
}

/** ASCII-рядок із регістрів SRNE: значущий лише молодший байт кожного регістра. */
export function asciiLowByte(regs: number[]): string {
  return regs.map((v) => String.fromCharCode(v & 0xff)).join("").replace(/[^\x20-\x7e]/g, "").trim();
}
