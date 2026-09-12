/**
 * Solarman V5 у режимі push: стік (LSW-3 та ін.) підключається до "Server B" по TCP
 * і шле кадри: 0x4110 hello, 0x4210 data, 0x4310 wifi?, 0x4710 heartbeat, 0x4810 report.
 * Сервер відповідає кадром з control = req - 0x3000, тим самим seq і серійником,
 * payload: frame_type (як у запиті), status 0x01, unix time (LE32), 4 байти нулів.
 * Формат зібраний з відкритих описів; уточнюється по реальних кадрах (logger_frames).
 */

export interface V5Frame { control: number; seq: number; serial: number; payload: Buffer; raw: Buffer }

/** Витягує повні кадри з буфера (може прийти кілька або частина). Повертає кадри і залишок. */
export function splitFrames(buf: Buffer): { frames: V5Frame[]; rest: Buffer } {
  const frames: V5Frame[] = [];
  let off = 0;
  while (off < buf.length) {
    const start = buf.indexOf(0xa5, off);
    if (start < 0) { off = buf.length; break; }
    if (buf.length - start < 11) { off = start; break; }
    const len = buf.readUInt16LE(start + 1);
    const total = 11 + len + 2;
    if (buf.length - start < total) { off = start; break; }
    const raw = buf.subarray(start, start + total);
    if (raw[total - 1] !== 0x15 || (raw.subarray(1, total - 2).reduce((a, b) => a + b, 0) & 0xff) !== raw[total - 2]) {
      off = start + 1; continue; // битий кадр — шукаємо наступний 0xA5
    }
    frames.push({ control: raw.readUInt16LE(3), seq: raw[5]!, serial: raw.readUInt32LE(7), payload: raw.subarray(11, total - 2), raw: Buffer.from(raw) });
    off = start + total;
  }
  return { frames, rest: Buffer.from(buf.subarray(off)) as Buffer };
}

export function buildResponse(req: V5Frame, ourSeq: number, now = new Date()): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = req.payload[0] ?? 0x01;
  payload[1] = 0x01;
  payload.writeUInt32LE(Math.floor(now.getTime() / 1000), 2);
  payload.writeUInt32LE(0, 6);
  const out = Buffer.alloc(11 + payload.length + 2);
  out[0] = 0xa5;
  out.writeUInt16LE(payload.length, 1);
  out.writeUInt16LE(req.control - 0x3000, 3);
  out[5] = req.seq; out[6] = ourSeq & 0xff;
  out.writeUInt32LE(req.serial, 7);
  payload.copy(out, 11);
  let sum = 0; for (let i = 1; i < out.length - 2; i++) sum += out[i]!;
  out[out.length - 2] = sum & 0xff;
  out[out.length - 1] = 0x15;
  return out;
}

export const CONTROL_NAMES: Record<number, string> = { 0x4110: "hello", 0x4210: "data", 0x4310: "wifi", 0x4710: "heartbeat", 0x4810: "report" };

/** Розбір data-кадру 0x4210: заголовок payload + сирі Modbus-дані. */
export function parseDataPayload(payload: Buffer) {
  if (payload.length < 15) return null;
  return {
    frameType: payload[0]!,
    sensorType: payload.readUInt16LE(1),
    totalWorkingTime: payload.readUInt32LE(3),
    powerOnTime: payload.readUInt32LE(7),
    offsetTime: payload.readUInt32LE(11),
    modbus: payload.subarray(15),
  };
}
