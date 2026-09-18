import { describe, it, expect } from "vitest";
import { flowGraph, loadSources } from "../src/flow.ts";

describe("loadSources", () => {
  it("день: сонця більше за споживання -> 100% від сонця", () => {
    expect(loadSources({ pv: 4200, load: 2020, bat: -1650, grid: -530 })).toEqual({ load: 2020, pv: 1, bat: 0, grid: 0 });
  });
  it("вечір: батарея + мережа, частки в сумі 1", () => {
    const s = loadSources({ pv: 0, load: 2430, bat: 235, grid: 2195 });
    expect(s.pv).toBe(0); expect(s.bat).toBeCloseTo(235 / 2430, 3); expect(s.bat + s.grid).toBeCloseTo(1, 6);
  });
  it("похибка датчиків: джерел менше за споживання -> нормалізується до 1", () => {
    const s = loadSources({ pv: 120, load: 1760, bat: 1500, grid: 0 });
    expect(s.pv + s.bat + s.grid).toBeCloseTo(1, 6); expect(s.grid).toBe(0);
  });
  it("немає даних або споживання в шумі -> нулі", () => {
    expect(loadSources({ pv: null, load: null, bat: null, grid: null })).toEqual({ load: 0, pv: 0, bat: 0, grid: 0 });
    expect(loadSources({ pv: 3000, load: 10, bat: 0, grid: 0 }).load).toBe(0);
  });
});

describe("flowGraph", () => {
  it("день: сонце -> споживання, заряд, експорт; баланс лінків = стокам", () => {
    const g = flowGraph({ pv: 4200, load: 2020, bat: -1650, grid: -530 });
    expect(g.sources.map((s) => s.kind)).toEqual(["pv"]);
    expect(g.sinks.map((s) => s.kind)).toEqual(["load", "charge", "export"]);
    expect(g.links).toEqual([{ from: "pv", to: "load", w: 2020 }, { from: "pv", to: "charge", w: 1650 }, { from: "pv", to: "export", w: 530 }]);
  });
  it("вечір: батарея і мережа живлять лише споживання", () => {
    const g = flowGraph({ pv: 0, load: 2430, bat: 235, grid: 2195 });
    expect(g.links).toEqual([{ from: "bat", to: "load", w: 235 }, { from: "grid", to: "load", w: 2195 }]);
  });
  it("мережа заряджає батарею вночі", () => {
    const g = flowGraph({ pv: 0, load: 500, bat: -2000, grid: 2500 });
    expect(g.links).toEqual([{ from: "grid", to: "load", w: 500 }, { from: "grid", to: "charge", w: 2000 }]);
  });
  it("лінки ніколи не перевищують джерело", () => {
    const g = flowGraph({ pv: 1000, load: 3000, bat: 500, grid: 0 });
    expect(g.links.reduce((a, l) => a + l.w, 0)).toBe(1500);
  });
});
