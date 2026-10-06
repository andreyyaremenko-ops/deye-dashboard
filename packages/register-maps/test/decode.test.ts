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
const HP3: Record<string, { serial: string; ratedW: number; minPvTotalKwh: number; mapId: string }> = {
  "2763543833": { serial: "2309208317", ratedW: 15000, minPvTotalKwh: 20000, mapId: "deye-hp3" },       // стенд: 15 kW, одна батарея, 2 MPPT
  "2989852238": { serial: "2407102212", ratedW: 30000, minPvTotalKwh: 70000, mapId: "deye-hp3-p105" },  // Dymer: 30 kW, дві батареї, 4 MPPT, протокол 1.05
  "2947846131": { serial: "2405040015", ratedW: 50000, minPvTotalKwh: 90000, mapId: "deye-hp3" },        // Budmayster: 50 kW, дві батареї, 4 MPPT, мікроінвертор на GEN-порту
};

describe("deye-hp3 на реальних дампах", () => {
  const hp3Files = dumpFiles.filter((f) => decodeIdentity(tableFromDump(f)).deviceType === 6);
  expect(hp3Files.length).toBeGreaterThan(0);
  for (const file of hp3Files) {
    const table = tableFromDump(file);
    const id = decodeIdentity(table);
    const map = mapForDeviceType(id.deviceType!, id.protocol);

    const known = HP3[file.split("_")[0]!];
    it(`${file}: ідентифікація`, () => {
      expect(known, "додайте очікування для нового HP3-дампа в HP3").toBeDefined();
      expect(id.deviceType).toBe(6);
      expect(id.inverterSerial).toBe(known!.serial);
      expect(id.ratedW).toBe(known!.ratedW);
      expect(map?.id).toBe(known!.mapId);
    });

    it(`${file}: баланс мережа + GEN + інвертор = навантаження`, () => {
      const m = decode(map!, table);
      expect(m.state).toBe("normal");
      // GEN-порт (мікроінвертор, генератор) входить у навантаження, але не проходить через CT мережі
      expect((m.grid_w as number) + (m.gen_w as number) + (m.inv_w as number)).toBe(m.load_w);
      expect(m.grid_w_l1 as number + (m.grid_w_l2 as number) + (m.grid_w_l3 as number)).toBe(m.grid_w);
      expect((m.gen_w_l1 as number) + (m.gen_w_l2 as number) + (m.gen_w_l3 as number)).toBe(m.gen_w);
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
  const m = decode(mapForDeviceType(6, decodeIdentity(table).protocol)!, table);
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

describe("deye-hp3 з мікроінвертором на GEN-порту (Budmayster)", () => {
  const table = tableFromDump("2947846131_20260926T074442Z.json");
  const m = decode(mapForDeviceType(6, decodeIdentity(table).protocol)!, table);

  it("gen_w = сума фаз, напруга GEN у мережевих межах", () => {
    expect(m.gen_w).toBe(10650);
    expect([m.gen_w_l1, m.gen_w_l2, m.gen_w_l3]).toEqual([3533, 3591, 3526]);   // мікроінвертори рівномірно по фазах
    for (const k of ["gen_v_l1", "gen_v_l2", "gen_v_l3"]) {
      expect(m[k]).toBeGreaterThan(180); expect(m[k]).toBeLessThan(260);
    }
  });

  it("GEN не бачить CT мережі: нев'язка load − grid − inv = gen", () => {
    expect((m.load_w as number) - (m.grid_w as number) - (m.inv_w as number)).toBe(m.gen_w);
    // по фазах те саме, з точністю до округлення регістрів
    for (const i of [1, 2, 3]) {
      const d = (m[`load_w_l${i}`] as number) - (m[`grid_w_l${i}`] as number) - (m[`inv_w_l${i}`] as number);
      expect(Math.abs(d - (m[`gen_w_l${i}`] as number)), `фаза ${i}`).toBeLessThan(15);
    }
  });

  it("баланс станції: сонце + GEN + мережа = споживання + заряд батареї (втрати до 5 %)", () => {
    const inW = (m.pv_w as number) + (m.gen_w as number) + (m.grid_w as number);
    const outW = (m.load_w as number) + -(m.bat_w as number);
    expect(m.bat_w).toBeLessThan(0);                                            // батарея заряджається
    expect(Math.abs(inW - outW) / inW).toBeLessThan(0.05);
  });

  it("лічильники GEN: добовий і загальний у 0.1 kWh", () => {
    expect(m.gen_day_kwh).toBe(22.5);
    expect(m.gen_total_kwh).toBe(10706.8);                                      // 32-бітний: 41532 + 1 x 65536
  });
});

describe("deye-hp3-p105: прошивка 1.05 рахує енергію в цілих kWh", () => {
  const table = tableFromDump("2989852238_20260918T171200Z.json");
  const id = decodeIdentity(table);

  it("варіант береться за протоколом з регістра 2, інакше — базова карта", () => {
    expect(id.protocol).toBe(0x0105);
    expect(mapForDeviceType(6, id.protocol)?.id).toBe("deye-hp3-p105");
    expect(mapForDeviceType(6, 0x0104)?.id).toBe("deye-hp3");
    expect(mapForDeviceType(6)?.id).toBe("deye-hp3");
    expect(mapForDeviceType(5, id.protocol)?.id).toBe("deye-lp3");   // варіант не чіпає інші типи
  });

  it("лічильники в kWh (x10 до базової карти), потужності без змін", () => {
    const m = decode(maps["deye-hp3-p105"]!, table);
    const base = decode(maps["deye-hp3"]!, table);
    // Dymer 18.09.2026 17:12: добові лічильники за сонячний день, а не десяті частки
    expect(m.pv_day_kwh).toBe(182);            expect(base.pv_day_kwh).toBe(18.2);
    expect(m.grid_sell_day_kwh).toBe(59);      expect(m.grid_buy_day_kwh).toBe(0);
    expect(m.bat_charge_day_kwh).toBe(146);    expect(m.load_day_kwh).toBe(13);
    expect(m.pv_total_kwh).toBe(70145);        expect(base.pv_total_kwh).toBe(7014.5);
    for (const k of Object.keys(m).filter((k) => k.endsWith("_kwh"))) {
      expect(m[k] as number, k).toBeCloseTo((base[k] as number) * 10, 6);
    }
    // потужності (DC x10) і все інше лишаються такими ж, як у базовій карті
    for (const k of Object.keys(m).filter((k) => !k.endsWith("_kwh"))) expect(m[k], k).toEqual(base[k]);
  });

  it("добовий баланс лічильників: сонце ≈ продаж + заряд + споживання", () => {
    const m = decode(maps["deye-hp3-p105"]!, table);
    const out = (m.grid_sell_day_kwh as number) + (m.bat_charge_day_kwh as number) + (m.load_day_kwh as number);
    expect(Math.abs((m.pv_day_kwh as number) - out)).toBeLessThan(0.2 * (m.pv_day_kwh as number));
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

/**
 * Anenji (SRNE V1.7). Реального дампа ще немає — перевіряємо саму карту на синтетичному кадрі:
 * знак струму батареї (у SRNE + = заряд, у нас навпаки), похідні добутки і порядок слів
 * у 32-бітних лічильниках (старше слово першим).
 */
describe("anenji-srne: карта за специфікацією", () => {
  const anenji = maps["anenji-srne"]!;
  /** Інвертор на мережі заряджає батарею: 1.2 кВт з мережі, PV спить, навантаження 450 Вт. */
  const onGrid = new Map<number, number>([
    [0x0100, 64], [0x0101, 512], [0x0102, 150],                     // SOC 64 %, 51.2 V, +15.0 A = заряд
    [0x0107, 0], [0x0108, 0], [0x0109, 0],
    [0x010f, 0], [0x0110, 0], [0x0111, 0],
    [0x010b, 1], [0x010e, 768],
    [0x0210, 4],                                                     // 4 = робота від мережі
    [0x0213, 2301], [0x0214, 73], [0x0215, 4998],                    // 230.1 V, 7.3 A, 49.98 Hz
    [0x0216, 2298], [0x0217, 0], [0x0218, 5000], [0x0219, 20],
    [0x021b, 450], [0x021c, 470], [0x021f, 7],
    [0x0220, 0xffec], [0x0221, 385],                                 // -2.0 °C (знакові) і 38.5 °C
    [0x02f0, 0],
    [0xf02f, 128], [0xf030, 94],                                     // 12.8 і 9.4 кВт·г за добу
    [0xf038, 1], [0xf039, 0x1a90], [0xf03a, 0], [0xf03b, 0x30d4],    // 7233.6 і 1250.0 кВт·г усього
    [0xf03d, 31], [0xf048, 0], [0xf049, 0x1f40],
  ]);

  it("знак струму батареї перевернуто, bat_w відʼємний на заряді", () => {
    const m = decode(anenji, onGrid);
    expect(m.bat_v).toBe(51.2);
    expect(m.bat_a).toBe(-15);                 // SRNE: +150 = заряд 15 A; у наших метриках заряд — мінус
    expect(m.bat_w).toBe(-768);                // = bat_v * bat_a, збігається з 0x010E (повна потужність заряду)
    expect(m.bat_charge_w).toBe(768);
  });

  it("мережа і навантаження: grid_w як добуток напруги на струм", () => {
    const m = decode(anenji, onGrid);
    expect(m.grid_v_l1).toBe(230.1);
    expect(m.grid_w).toBeCloseTo(1679.7, 1);   // 230.1 * 7.3
    expect(m.load_w).toBe(450);
    expect(m.grid_hz).toBe(49.98);
    expect(m.pv_w).toBe(0);
    expect(m.state).toBe("normal");
    expect(m.work_mode).toBe("mains");
    expect(m.temp_dc_c).toBe(-2);
    expect(m.temp_heatsink_c).toBe(38.5);
  });

  it("лічильники: старше слово першим", () => {
    const m = decode(anenji, onGrid);
    expect(m.pv_day_kwh).toBe(12.8);
    expect(m.load_day_kwh).toBe(9.4);
    expect(m.pv_total_kwh).toBe(7233.6);       // 0x00011a90 = 72336 -> 7233.6 кВт·г
    expect(m.load_total_kwh).toBe(1250);
    expect(m.grid_buy_day_kwh).toBe(3.1);
    expect(m.grid_buy_total_kwh).toBe(800);
  });

  it("на однофазній моделі без другого MPPT і другої фази похідних не вигадує", () => {
    const only = new Map<number, number>([[0x0100, 55], [0x0101, 500], [0x0102, 0], [0x0109, 1200]]);
    const m = decode(anenji, only);
    expect(m.pv_w).toBeUndefined();            // немає pv2_w — суми теж немає
    expect(m.grid_w).toBeUndefined();          // немає напруги мережі — добутку немає
    expect(m.bat_w).toBe(0);
    expect(m.load_w_l2).toBeUndefined();
  });

  it("карта не плутається з Deye за типом пристрою", () => {
    expect(mapForDeviceType(anenji.deviceType)?.id).toBe("anenji-srne");
    for (const t of [3, 5, 6]) expect(mapForDeviceType(t)?.id).not.toBe("anenji-srne");
    expect(anenji.pollRanges.every(([lo, hi]) => hi > lo && hi - lo <= 20)).toBe(true);   // SRNE гарантує 20 регістрів за раз
  });
});
