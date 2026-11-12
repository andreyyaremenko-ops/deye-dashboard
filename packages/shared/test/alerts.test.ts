import { describe, it, expect } from "vitest";
import { detectAlerts, newAlertMemory, PV_REPEAT_MS, type AlertThresholds } from "../src/alerts.ts";

const OFF: AlertThresholds = { alertSoc: null, alertPvPct: null, pvKwp: null };
const kinds = (ev: { kind: string }[]) => ev.map((e) => e.kind);

describe("звукові сповіщення", () => {
  it("мережа: перший замір лише запамʼятовується, подія після двох замірів поспіль", () => {
    const mem = newAlertMemory();
    expect(detectAlerts(mem, { grid_v_l1: 0 }, OFF, 0)).toEqual([]);        // екран відкрили посеред відключення
    expect(detectAlerts(mem, { grid_v_l1: 231 }, OFF, 1)).toEqual([]);      // одиночний замір — ще не подія
    expect(kinds(detectAlerts(mem, { grid_v_l1: 230 }, OFF, 2))).toEqual(["grid_up"]);
    expect(detectAlerts(mem, { grid_v_l1: 0 }, OFF, 3)).toEqual([]);
    expect(detectAlerts(mem, { grid_v_l1: 229 }, OFF, 4)).toEqual([]);      // провал на один замір скасовується
    expect(detectAlerts(mem, { grid_v_l1: 0 }, OFF, 5)).toEqual([]);
    const ev = detectAlerts(mem, { grid_v_l1: 0 }, OFF, 6);
    expect(kinds(ev)).toEqual(["grid_down"]);
    expect(ev[0]!.text).toBe("Зникла мережа");
  });

  it("мережа: без напруги в замірі подій немає", () => {
    const mem = newAlertMemory();
    for (let i = 0; i < 5; i++) expect(detectAlerts(mem, { load_w: 100 }, OFF, i)).toEqual([]);
  });

  it("критичний заряд: на перетині порогу, з гістерезисом", () => {
    const t = { ...OFF, alertSoc: 20 };
    const mem = newAlertMemory();
    expect(detectAlerts(mem, { bat_soc: 25 }, t, 0)).toEqual([]);
    const ev = detectAlerts(mem, { bat_soc: 20 }, t, 1);
    expect(kinds(ev)).toEqual(["soc_low"]);
    expect(ev[0]!.text).toContain("20 %");
    expect(detectAlerts(mem, { bat_soc: 21 }, t, 2)).toEqual([]);           // коливання біля межі мовчить
    expect(detectAlerts(mem, { bat_soc: 19 }, t, 3)).toEqual([]);
    expect(detectAlerts(mem, { bat_soc: 23 }, t, 4)).toEqual([]);           // вийшли з зони: 20 + 3
    expect(kinds(detectAlerts(mem, { bat_soc: 20 }, t, 5))).toEqual(["soc_low"]);
  });

  it("критичний заряд: екран, відкритий уже на низькому заряді, не пищить", () => {
    const mem = newAlertMemory();
    expect(detectAlerts(mem, { bat_soc: 10 }, { ...OFF, alertSoc: 20 }, 0)).toEqual([]);
    expect(detectAlerts(mem, { bat_soc: 9 }, { ...OFF, alertSoc: 20 }, 1)).toEqual([]);
  });

  it("генерація: відсоток від номіналу, не частіше раз на годину", () => {
    const t = { ...OFF, alertPvPct: 90, pvKwp: 10 };
    const mem = newAlertMemory();
    expect(detectAlerts(mem, { pv_w: 5000 }, t, 0)).toEqual([]);
    const ev = detectAlerts(mem, { pv_w: 9200 }, t, PV_REPEAT_MS);
    expect(kinds(ev)).toEqual(["pv_high"]);
    expect(ev[0]!.text).toBe("Потужна генерація: 9.2 кВт, 92 % від номіналу");
    expect(detectAlerts(mem, { pv_w: 8000 }, t, PV_REPEAT_MS + 1)).toEqual([]);   // 80 % — вийшли з зони (90 − 5)
    expect(detectAlerts(mem, { pv_w: 9300 }, t, PV_REPEAT_MS + 2)).toEqual([]);   // знову високо, але година не минула
    expect(detectAlerts(mem, { pv_w: 5000 }, t, 2 * PV_REPEAT_MS)).toEqual([]);
    expect(kinds(detectAlerts(mem, { pv_w: 9500 }, t, 2 * PV_REPEAT_MS + 1))).toEqual(["pv_high"]);
  });

  it("генерація без номіналу панелей вимкнена", () => {
    const mem = newAlertMemory();
    const t = { ...OFF, alertPvPct: 50, pvKwp: null };
    expect(detectAlerts(mem, { pv_w: 1000 }, t, 0)).toEqual([]);
    expect(detectAlerts(mem, { pv_w: 99999 }, t, 1)).toEqual([]);
  });
});
