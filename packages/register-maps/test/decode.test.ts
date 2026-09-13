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
  const hp3Files = dumpFiles.filter((f) => decodeIdentity(tableFromDump(f)).deviceType === 6);
  expect(hp3Files.length).toBeGreaterThan(0);
  for (const file of hp3Files) {
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

describe("deye-lp1 (однофазний 6 kW, ON-Coffe) на реальному кадрі", () => {
  const files = dumpFiles.filter((f) => decodeIdentity(tableFromDump(f)).deviceType === 3);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const table = tableFromDump(file);
    const id = decodeIdentity(table);
    const map = mapForDeviceType(3)!;
    it(`${file}: ідентифікація і баланс`, () => {
      expect(id.inverterSerial).toBe("2510163946");
      expect(map.id).toBe("deye-lp1");
      const m = decode(map, table);
      expect(m.state).toBe("normal");
      expect((m.grid_w as number) + (m.inv_w as number)).toBe(m.load_w);          // 20 + 442 = 462
      expect(m.pv_w).toBe(797); expect(m.bat_w).toBe(-343);                        // сонце заряджає батарею
      expect((m.pv_w as number) + (m.bat_w as number)).toBeGreaterThan(m.inv_w as number); // PV − заряд ≈ інвертор + втрати
      expect(m.bat_soc).toBe(40); expect(m.bat_v).toBeCloseTo(52.87, 2); expect(m.bat_temp_c).toBe(24.5);
      expect(m.grid_hz).toBe(50.01); expect(m.grid_v_l1).toBe(234.2);
      expect(m.grid_buy_total_kwh).toBe(3864.1); expect(m.load_total_kwh).toBe(6748.9); expect(m.pv_total_kwh).toBe(2814.6);
      // енергобаланс лічильників: спожито ≈ куплено + сонце − продано (± втрати батареї)
      expect(Math.abs((m.load_total_kwh as number) - ((m.grid_buy_total_kwh as number) + (m.pv_total_kwh as number) - (m.grid_sell_total_kwh as number)))).toBeLessThan(200);
    });
  }
});

describe("deye-lp3 (трифазний LV 12 kW, Stiklyashka) на реальному кадрі", () => {
  const files = dumpFiles.filter((f) => decodeIdentity(tableFromDump(f)).deviceType === 5);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const table = tableFromDump(file);
    const id = decodeIdentity(table);
    const map = mapForDeviceType(5)!;
    it(`${file}: ідентифікація, баланс, LV-батарея`, () => {
      expect(id.inverterSerial).toBe("2507225076"); expect(id.ratedW).toBe(12000);
      expect(map.id).toBe("deye-lp3");
      const m = decode(map, table);
      expect(m.state).toBe("normal");
      expect(Math.abs((m.grid_w as number) + (m.inv_w as number) - (m.load_w as number))).toBeLessThan(15);   // 1020 − 54 ≈ 959
      expect((m.grid_w_l1 as number) + (m.grid_w_l2 as number) + (m.grid_w_l3 as number)).toBe(m.grid_w);
      expect((m.load_w_l1 as number) + (m.load_w_l2 as number) + (m.load_w_l3 as number)).toBe(m.load_w);
      expect(m.bat_v).toBeCloseTo(52.72, 2); expect(m.bat_soc).toBe(50); expect(m.bat_temp_c).toBe(22.5);
      for (const k of ["grid_v_l1", "grid_v_l2", "grid_v_l3"]) { expect(m[k]).toBeGreaterThan(180); expect(m[k]).toBeLessThan(260); }
      expect(m.grid_hz).toBe(49.95);
      expect(m.load_total_kwh).toBe(10772.9); expect(m.grid_buy_total_kwh).toBe(6269.2); expect(m.pv_total_kwh).toBe(5811.1);
      expect(Math.abs((m.load_total_kwh as number) - ((m.grid_buy_total_kwh as number) + (m.pv_total_kwh as number) - (m.grid_sell_total_kwh as number)))).toBeLessThan(1500); // втрати батареї ~280 kWh + інвертор
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
