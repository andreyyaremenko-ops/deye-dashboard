import { describe, it, expect } from "vitest";
import { pvStrings, stringScaleW } from "../src/strings.ts";

describe("pvStrings", () => {
  it("бере лише входи, що є в метриках моделі (LP має два)", () => {
    const { all, used } = pvStrings({ pv1_w: 800, pv1_v: 310, pv1_a: 2.6, pv2_w: 640, pv2_v: 298, pv2_a: 2.1 });
    expect(all.map((s) => s.i)).toEqual([1, 2]);
    expect(used.map((s) => s.w)).toEqual([800, 640]);
    expect(used[0]).toEqual({ i: 1, w: 800, v: 310, a: 2.6 });
  });

  it("ховає непідключений вхід (нуль ват і нуль вольт), решту лишає", () => {
    const { all, used } = pvStrings({
      pv1_w: 9410, pv1_v: 698.8, pv1_a: 13.5, pv2_w: 9180, pv2_v: 688, pv2_a: 13.4,
      pv3_w: 6170, pv3_v: 597.8, pv3_a: 8.7, pv4_w: 0, pv4_v: 0, pv4_a: 0,
    });
    expect(all).toHaveLength(4);
    expect(used.map((s) => s.i)).toEqual([1, 2, 3]);
  });

  it("вхід під напругою, але без струму, лишається видимим", () => {
    const { used } = pvStrings({ pv1_w: 0, pv1_v: 320, pv1_a: 0, pv2_w: 500, pv2_v: 300, pv2_a: 1.6 });
    expect(used.map((s) => s.i)).toEqual([1, 2]);
  });

  it("вночі всі нулі — показуємо всі входи, а не порожній список", () => {
    const { used } = pvStrings({ pv1_w: 0, pv1_v: 0, pv2_w: 0, pv2_v: 0 });
    expect(used.map((s) => s.i)).toEqual([1, 2]);
  });

  it("без pv-метрик (модель без панелей у кадрі) — порожньо", () => {
    expect(pvStrings({ load_w: 300 })).toEqual({ all: [], used: [] });
    expect(pvStrings(undefined).all).toEqual([]);
  });

  it("шкала смуг: максимум зі стрінгів, але не менше мінімуму", () => {
    expect(stringScaleW([{ i: 1, w: 1850, v: null, a: null }, { i: 2, w: 830, v: null, a: null }])).toBe(1850);
    expect(stringScaleW([{ i: 1, w: 12, v: null, a: null }])).toBe(100);
    expect(stringScaleW([])).toBe(100);
  });
});
