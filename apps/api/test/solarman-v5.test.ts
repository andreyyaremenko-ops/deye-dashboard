import { describe, it, expect } from "vitest";
import { buildResponse, parseDataPayload, splitFrames } from "../src/solarman/v5.ts";

// реальний кадр-відповідь стіка з дампу (control 0x1510) — валідна структура V5
const REAL = "a510001015c45c1955b8a40201c7022c013a1b0000365f79690600ea15";

describe("solarman v5 push framing", () => {
  it("розбирає кадр, серійник і відкидає биті", () => {
    const { frames, rest } = splitFrames(Buffer.from("00" + REAL + REAL.slice(0, 20), "hex"));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.serial).toBe(2763543833);
    expect(frames[0]!.control).toBe(0x1510);
    expect(rest.length).toBe(10); // неповний хвіст чекає наступного chunk
    const bad = Buffer.from(REAL, "hex"); bad[12] = bad[12]! ^ 1;
    expect(splitFrames(bad).frames).toHaveLength(0);
  });
  it("відповідь: control - 0x3000, той самий seq і серійник, час", () => {
    const req = splitFrames(Buffer.from(REAL.replace("1015", "1042"), "hex")).frames[0]; // підмінимо на 0x4210 без перерахунку суми
    const f = { control: 0x4210, seq: 0xc4, serial: 2763543833, payload: Buffer.from([0x01, 0, 0]), raw: Buffer.alloc(0) };
    const now = new Date("2026-09-12T20:00:00Z");
    const r = buildResponse(f, 7, now);
    expect(r[0]).toBe(0xa5); expect(r[r.length - 1]).toBe(0x15);
    expect(r.readUInt16LE(3)).toBe(0x1210);
    expect(r[5]).toBe(0xc4); expect(r[6]).toBe(7);
    expect(r.readUInt32LE(7)).toBe(2763543833);
    expect(r[11]).toBe(0x01); expect(r[12]).toBe(0x01);
    expect(r.readUInt32LE(13)).toBe(Math.floor(now.getTime() / 1000));
    // контрольна сума перевіряється splitFrames
    expect(splitFrames(r).frames).toHaveLength(1);
    void req;
  });
  it("data payload: заголовок 15 байт + modbus", () => {
    const p = Buffer.concat([Buffer.from([0x01, 0x02, 0x00]), Buffer.alloc(12), Buffer.from([1, 3, 2, 0, 6])]);
    const d = parseDataPayload(p)!;
    expect(d.frameType).toBe(1); expect(d.sensorType).toBe(2); expect(d.modbus.toString("hex")).toBe("0103020006");
  });
});
