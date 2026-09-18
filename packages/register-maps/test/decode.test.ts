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

/** Очікування для HP3-дампів за серійником стіка (імʼя файлу <serial>_<час>.json). */
const HP3: Record<string, { serial: string; ratedW: number; minPvTotalKwh: number }> = {
  "2763543833": { serial: "2309208317", ratedW: 15000, minPvTotalKwh: 20000 },   // стенд: 15 kW, одна батарея, 2 MPPT
  "2989852238": { serial: "2407102212", ratedW: 30000, minPvTotalKwh: 7000 },    // Dymer: 30 kW, дві батареї, 4 MPPT
};

describe("deye-hp3 на реальних дампах", () => {
  const hp3Files = dumpFiles.filter((f) => decodeIdentity(tableFromDump(f)).deviceType === 6);
  expect(hp3Files.length).toBeGreaterThan(0);
  for (const file of hp3Files) {
    const table = tableFromDump(file);
    const id = decodeIdentity(table);
    const map = mapForDeviceType(id.deviceType!);

    const known = HP3[file.split("_")[0]!];
    it(`${file}: ідентифікація`, () => {
      expect(known, "додайте очікування для нового HP3-дампа в HP3").toBeDefined();
      expect(id.deviceType).toBe(6);
      expect(id.inverterSerial).toBe(known!.serial);
      expect(id.ratedW).toBe(known!.ratedW);
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
      expect(m.pv_total_kwh).toBeGreaterThan(known!.minPvTotalKwh); // 32-бітний лічильник (у стенда high word = 4)
      expect(m.pv_w).toBe((m.pv1_w as number) + (m.pv2_w as number) + (m.pv3_w as number) + (m.pv4_w as number));
      expect(m.bat_w).toBe((m.bat1_w as number) + (m.bat2_w as number));
    });
  }
});

describe("deye-hp3 30 kW з двома батареями (Dymer): потужність DC у десятках ват", () => {
  const table = tableFromDump("2989852238_20260918T171200Z.json");
  const m = decode(mapForDeviceType(6)!, table);
  it("кожна батарея: P = raw x 10 і збігається з U x I", () => {
    expect(m.bat1_w).toBe(14970); expect(m.bat2_w).toBe(14980);
    expect(Math.abs((m.bat_v as number) * (m.bat1_a as number) - (m.bat1_w as number))).toBeLessThan(150);
    expect(Math.abs((m.bat2_v as number) * (m.bat2_a as number) - (m.bat2_w as number))).toBeLessThan(150);
    expect(m.bat_soc).toBe(74); expect(m.bat2_soc).toBe(74);
  });
  it("сумарна батарея і баланс DC -> AC: сонце + батарея ≈ вихід інвертора (втрати до 8 %)", () => {
    expect(m.bat_w).toBe(29950);
    expect(m.bat_a).toBeCloseTo(47.43, 2);
    const dc = (m.pv_w as number) + (m.bat_w as number), ac = m.inv_w as number;
    expect(ac).toBeLessThan(dc); expect(ac / dc).toBeGreaterThan(0.92);
    expect((m.grid_w as number) + ac).toBe(m.load_w);           // -26775 + 28555 = 1780: батареї продають у мережу
  });
  it("чотири входи панелей: увечері майже нуль, pv_w = сума чотирьох", () => {
    expect(m.pv3_w).toBe(10); expect(m.pv4_w).toBe(0); expect(m.pv_w).toBe(10);
    expect(m.pv3_v).toBe(165.4);
  });
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
    const t = new Map<number, number>([[590, 0xfc18], [595, 0], [540, 1250], [516, 7750], [517, 1]]);
    const m = decode(maps["deye-hp3"]!, t);
    expect(m.bat1_w).toBe(-10000);   // HV: регістр у десятках ват, знак мінус — заряд
    expect(m.bat_w).toBe(-10000);    // сума двох батарей, друга відсутня
    expect(m.temp_dc_c).toBe(25);
    expect(m.bat_charge_total_kwh).toBe(7328.6);
  });
  it("пропускає поля, яких нема в таблиці", () => {
    const m = decode(maps["deye-hp3"]!, new Map([[588, 55]]));
    expect(m).toEqual({ bat_soc: 55 });
  });
});
