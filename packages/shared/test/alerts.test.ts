import { describe, it, expect } from "vitest";
import { detectAirAlert, detectAlerts, newAirMemory, newAlertMemory, PV_REPEAT_MS, type AlertThresholds } from "../src/alerts.ts";
import type { AlertFeed } from "../src/feeds.ts";

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

describe("повітряна тривога", () => {
  const feed = (active: boolean, level: AlertFeed["level"] = null): AlertFeed =>
    ({ updatedAt: "2026-11-13T10:00:00Z", oblast: "Київська область", active, since: null, level });

  it("перший стан лише запамʼятовується: екран, відкритий посеред тривоги, не оголошує її", () => {
    const mem = newAirMemory();
    expect(detectAirAlert(mem, feed(true, "red"))).toEqual([]);
    expect(detectAirAlert(mem, feed(true, "red"))).toEqual([]);
    expect(kinds(detectAirAlert(mem, feed(false)))).toEqual(["air_clear"]);
  });

  it("оголошення з рівнем, відбій, без повторів", () => {
    const mem = newAirMemory();
    detectAirAlert(mem, feed(false));
    const ev = detectAirAlert(mem, feed(true, "yellow"));
    expect(ev).toEqual([{ kind: "air_alert", level: "yellow", text: "Повітряна тривога · Київська область · дронова загроза" }]);
    expect(detectAirAlert(mem, feed(true, "yellow"))).toEqual([]);
    const off = detectAirAlert(mem, feed(false));
    expect(off).toEqual([{ kind: "air_clear", text: "Відбій тривоги · Київська область" }]);
    expect(detectAirAlert(mem, feed(false))).toEqual([]);
  });

  it("дрони -> ракети посеред тривоги оголошується, зниження рівня — ні", () => {
    const mem = newAirMemory();
    detectAirAlert(mem, feed(false));
    detectAirAlert(mem, feed(true, "yellow"));
    const up = detectAirAlert(mem, feed(true, "red"));
    expect(up.map((e) => [e.kind, e.level])).toEqual([["air_alert", "red"]]);
    expect(detectAirAlert(mem, feed(true, "yellow"))).toEqual([]);
    expect(detectAirAlert(mem, feed(true, null))).toEqual([]);   // рівень зник з джерела — не нова загроза
  });

  it("тривога без рівня (дзеркало) і зникнення стрічки — не відбій", () => {
    const mem = newAirMemory();
    detectAirAlert(mem, feed(false));
    expect(detectAirAlert(mem, feed(true)).map((e) => [e.kind, e.level])).toEqual([["air_alert", null]]);
    expect(detectAirAlert(mem, null)).toEqual([]);
    expect(detectAirAlert(mem, feed(true))).toEqual([]);
  });
});
