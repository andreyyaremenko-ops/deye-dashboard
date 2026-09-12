import { describe, it, expect } from "vitest";
import { estimateRuntime, fmtHours, gridDown } from "../src/energy.ts";

describe("режим відключення", () => {
  it("мережа є / немає за напругою", () => {
    expect(gridDown({ grid_v_l1: 234, grid_v_l2: 239, grid_v_l3: 225 })).toBe(false);
    expect(gridDown({ grid_v_l1: 0, grid_v_l2: 0, grid_v_l3: 0 })).toBe(true);
    expect(gridDown({ grid_v_l1: 2.3, grid_v_l2: 0, grid_v_l3: 0, grid_w: 0 })).toBe(true);
    expect(gridDown({ load_w: 500 })).toBe(false); // немає даних — не лякаємо
  });
  it("прогноз за ємністю: 10 kWh, 60% -> 20%, 2 kW = 2 год", () => {
    const r = estimateRuntime({ bat_soc: 60, bat_w: 2000 }, { capacityKwh: 10, minSoc: 20 });
    expect(r?.method).toBe("capacity"); expect(r?.hours).toBeCloseTo(2, 5);
  });
  it("прогноз за швидкістю: 80% -> 70% за 30 хв => 50% запасу за 2.5 год", () => {
    const t = Date.now();
    const r = estimateRuntime({ bat_soc: 70, bat_w: 1500 }, { minSoc: 20, socHistory: [[t - 30 * 60_000, 80], [t, 70]] });
    expect(r?.method).toBe("slope"); expect(r?.hours).toBeCloseTo(2.5, 5);
  });
  it("якщо зникне світло: за споживанням, коли мережа є", () => {
    const r = estimateRuntime({ bat_soc: 100, bat_w: 0, load_w: 4000 }, { capacityKwh: 10, minSoc: 20, assumeLoad: true });
    expect(r?.method).toBe("load"); expect(r?.hours).toBeCloseTo(2, 5);
    expect(estimateRuntime({ bat_soc: 100, bat_w: 0, load_w: 4000 }, { capacityKwh: 10, minSoc: 20 })).toBeNull();
  });
  it("не рахує, коли заряджається або історія коротка", () => {
    expect(estimateRuntime({ bat_soc: 60, bat_w: -800 }, { capacityKwh: 10 })).toBeNull();
    expect(estimateRuntime({ bat_soc: 60, bat_w: 800 }, { socHistory: [[Date.now() - 60_000, 61], [Date.now(), 60]] })).toBeNull();
  });
  it("форматування", () => {
    expect(fmtHours(2.5)).toBe("2 год 30 хв"); expect(fmtHours(0.4)).toBe("24 хв"); expect(fmtHours(60)).toBe("3 дн"); expect(fmtHours(NaN)).toBe("—");
  });
});
