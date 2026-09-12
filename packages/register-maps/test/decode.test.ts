import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decode, decodeIdentity, hexToRegs, mapForDeviceType, rangesToTable, maps } from "../src/index.js";

// Реальні дампи зі spike/dumps — фікстури
const dumpsDir = join(import.meta.dirname, "../../../spike/dumps");
const dumpFiles = readdirSync(dumpsDir).filter((f: string) => f.endsWith(".json"));

function tableFromDump(file: string) {
  const d = JSON.parse(readFileSync(join(dumpsDir, file), "utf8"));
  const t = new Map<number, number>();
  for (const [k, v] of Object.entries<{ dec: number }>(d.registers)) t.set(Number(k), v.dec);
  return t;
}

describe("hexToRegs / rangesToTable", () => {
  it("парсить hex з пристрою", () => {
    expect(hexToRegs("00060001")).toEqual([6, 1]);
    const t = rangesToTable([{ start: 500, regs: "0002ffff" }]);
    expect(t.get(500)).toBe(2);
    expect(t.get(501)).toBe(0xffff);
  });
  it("відкидає непарний hex", () => {
    expect(() => hexToRegs("abc")).toThrow();
  });
});

describe("deye-hp3 на реальних дампах", () => {
  expect(dumpFiles.length).toBeGreaterThan(0);
  for (const file of dumpFiles) {
    const table = tableFromDump(file);
    const id = decodeIdentity(table);
    const map = mapForDeviceType(id.deviceType!);

    it(`${file}: ідентифікація`, () => {
      expect(id.deviceType).toBe(6);
      expect(id.inverterSerial).toBe("2309208317");
      expect(id.ratedW).toBe(15000);
      expect(map?.id).toBe("deye-hp3");
    });

    it(`${file}: баланс мережа + інвертор = навантаження`, () => {
      const m = decode(map!, table);
      expect(m.state).toBe("normal");
      expect((m.grid_w as number) + (m.inv_w as number)).toBe(m.load_w);
      expect(m.grid_w_l1 as number + (m.grid_w_l2 as number) + (m.grid_w_l3 as number)).toBe(m.grid_w);
    });

    it(`${file}: правдоподібні значення`, () => {
      const m = decode(map!, table);
      expect(m.bat_soc).toBeGreaterThanOrEqual(0);
      expect(m.bat_soc).toBeLessThanOrEqual(100);
      expect(m.bat_v).toBeGreaterThan(200); // HV-батарея
      expect(m.grid_hz).toBeCloseTo(50, 0);
      for (const k of ["grid_v_l1", "grid_v_l2", "grid_v_l3"]) {
        expect(m[k]).toBeGreaterThan(180);
        expect(m[k]).toBeLessThan(260);
      }
      expect(m.pv_total_kwh).toBeGreaterThan(20000); // 32-бітний лічильник, high word = 4
      expect(m.pv_w).toBe((m.pv1_w as number) + (m.pv2_w as number));
    });
  }
});

describe("signed / words / offset", () => {
  it("знакові значення і температура з offset", () => {
    const t = new Map<number, number>([[590, 0xfc18], [540, 1250], [516, 7750], [517, 1]]);
    const m = decode(maps["deye-hp3"]!, t);
    expect(m.bat_w).toBe(-1000);
    expect(m.temp_dc_c).toBe(25);
    expect(m.bat_charge_total_kwh).toBe(7328.6);
  });
  it("пропускає поля, яких нема в таблиці", () => {
    const m = decode(maps["deye-hp3"]!, new Map([[588, 55]]));
    expect(m).toEqual({ bat_soc: 55 });
  });
});
