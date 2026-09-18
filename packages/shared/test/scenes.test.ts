import { describe, it, expect } from "vitest";
import { screenConfigSchema } from "../src/index.ts";
import { eligibleScenes, inSchedule, nextScene, type SceneLike } from "../src/scenes.ts";

const W = (id: string) => ({ id, type: "clock" as const, x: 0, y: 0, w: 20, h: 10, props: {} });
const sc = (id: string, o: Partial<SceneLike> = {}): SceneLike => ({ id, durationS: 30, schedule: null, onOutage: false, ...o });
const at = (h: number, m = 0) => new Date(2026, 8, 18, h, m);

describe("screenConfigSchema: сцени", () => {
  it("старий конфіг без scenes стає однією сценою main", () => {
    const c = screenConfigSchema.parse({ backgroundId: null, widgets: [W("a")], radioUrl: null, theme: "light" });
    expect(c.scenes).toHaveLength(1);
    expect(c.scenes[0]).toMatchObject({ id: "main", theme: "light", durationS: 30, schedule: null, onOutage: false });
    expect(c.scenes[0]!.widgets.map((w) => w.id)).toEqual(["a"]);
    expect(c.rotation).toBe("sequence");
  });
  it("верхній рівень дзеркалить першу сцену, навіть якщо прийшов застарілим", () => {
    const c = screenConfigSchema.parse({ backgroundId: null, widgets: [W("old")], radioUrl: null, theme: "dark",
      scenes: [{ id: "s1", theme: "light", widgets: [W("n1")] }, { id: "s2", widgets: [W("n2")], durationS: 10 }] });
    expect(c.widgets.map((w) => w.id)).toEqual(["n1"]); expect(c.theme).toBe("light");
    expect(c.scenes[1]).toMatchObject({ id: "s2", durationS: 10, theme: "dark" });
  });
  it("повторний розбір ідемпотентний; понад 10 сцен і поганий час відхиляються", () => {
    const c = screenConfigSchema.parse({ backgroundId: null, widgets: [], radioUrl: null });
    expect(screenConfigSchema.parse(c)).toEqual(c);
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `s${i}` }));
    expect(screenConfigSchema.safeParse({ backgroundId: null, widgets: [], radioUrl: null, scenes: many }).success).toBe(false);
    expect(screenConfigSchema.safeParse({ backgroundId: null, widgets: [], radioUrl: null, scenes: [{ id: "a", schedule: { from: "25:00", to: "10:00" } }] }).success).toBe(false);
  });
});

describe("розклад і ротація", () => {
  it("inSchedule: звичайний інтервал, через північ, from == to", () => {
    expect(inSchedule({ from: "08:00", to: "12:00" }, 8 * 60)).toBe(true);
    expect(inSchedule({ from: "08:00", to: "12:00" }, 12 * 60)).toBe(false);
    expect(inSchedule({ from: "22:00", to: "02:00" }, 23 * 60)).toBe(true);
    expect(inSchedule({ from: "22:00", to: "02:00" }, 60)).toBe(true);
    expect(inSchedule({ from: "22:00", to: "02:00" }, 12 * 60)).toBe(false);
    expect(inSchedule({ from: "09:00", to: "09:00" }, 3 * 60)).toBe(true);
    expect(inSchedule(null, 0)).toBe(true);
  });
  it("eligibleScenes: розклад, відключення світла, ніколи не порожньо", () => {
    const scenes = [sc("menu-am", { schedule: { from: "08:00", to: "12:00" } }), sc("menu-pm", { schedule: { from: "12:00", to: "22:00" } }), sc("power", { onOutage: true })];
    expect(eligibleScenes(scenes, at(9), false).map((s) => s.id)).toEqual(["menu-am", "power"]);
    expect(eligibleScenes(scenes, at(15), false).map((s) => s.id)).toEqual(["menu-pm", "power"]);
    expect(eligibleScenes(scenes, at(15), true).map((s) => s.id)).toEqual(["power"]);
    expect(eligibleScenes([sc("a", { schedule: { from: "08:00", to: "09:00" } })], at(20), false).map((s) => s.id)).toEqual(["a"]);
    expect(eligibleScenes([sc("a"), sc("b")], at(20), true).map((s) => s.id)).toEqual(["a", "b"]); // немає onOutage -> звичайна ротація
  });
  it("nextScene: по колу; поточної немає серед дозволених -> перша; одна сцена -> вона сама", () => {
    const el = [sc("a"), sc("b"), sc("c")];
    expect(nextScene(el, "a", "sequence")!.id).toBe("b");
    expect(nextScene(el, "c", "sequence")!.id).toBe("a");
    expect(nextScene(el, "zzz", "sequence")!.id).toBe("a");
    expect(nextScene([sc("a")], "a", "sequence")!.id).toBe("a");
    expect(nextScene([], null, "sequence")).toBeNull();
  });
  it("nextScene random: не повторює поточну, якщо є вибір", () => {
    const el = [sc("a"), sc("b"), sc("c")];
    for (const r of [0, 0.3, 0.6, 0.999]) expect(nextScene(el, "b", "random", () => r)!.id).not.toBe("b");
    expect(nextScene([sc("a")], "a", "random", () => 0.5)!.id).toBe("a");
  });
});
