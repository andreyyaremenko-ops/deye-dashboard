import { describe, it, expect } from "vitest";
import { menuStyle, hexToRgba, neonSignStyle, MENU_FONT_SIZE } from "../src/menu.ts";

describe("menuStyle", () => {
  it("порожні props: системний шрифт, стандартний розмір, кольори теми", () => {
    const s = menuStyle({});
    expect(s.fontId).toBe("system"); expect(s.fontSize).toBe(MENU_FONT_SIZE.default);
    expect(s.color).toBeNull(); expect(s.accent).toBeNull(); expect(s.background).toBeNull();
  });
  it("старий size: small|medium|large -> vw; fontSize має пріоритет і обрізається до меж", () => {
    expect(menuStyle({ size: "small" }).fontSize).toBe(1.3);
    expect(menuStyle({ size: "large" }).fontSize).toBe(2.2);
    expect(menuStyle({ size: "large", fontSize: 3 }).fontSize).toBe(3);
    expect(menuStyle({ fontSize: 99 }).fontSize).toBe(MENU_FONT_SIZE.max);
    expect(menuStyle({ fontSize: "2.5" }).fontSize).toBe(2.5);
  });
  it("невалідні кольори й шрифти ігноруються", () => {
    const s = menuStyle({ font: "comic", color: "red", accent: "#zzz", bg: "#12345" });
    expect(s.fontId).toBe("system"); expect(s.color).toBeNull(); expect(s.accent).toBeNull(); expect(s.background).toBeNull();
  });
  it("фон картки: власний колір, або лише прозорість поверх кольору теми", () => {
    expect(menuStyle({ bg: "#301010", bgAlpha: 65 }).background).toBe("rgba(48, 16, 16, 0.65)");
    expect(menuStyle({ bg: "#301010" }, "dark").background).toBe("rgba(48, 16, 16, 0.55)");
    expect(menuStyle({ bgAlpha: 85 }, "light").background).toBe("rgba(255, 255, 255, 0.85)");
    expect(menuStyle({ bgAlpha: "" }).background).toBeNull();
  });
  it("неон і дошка: свій шрифт і кольори за замовчуванням, власні мають пріоритет, фон картки не діє", () => {
    const n = menuStyle({ look: "neon", bg: "#301010", bgAlpha: 65 });
    expect(n.look).toBe("neon"); expect(n.fontId).toBe("comfortaa");
    expect(n.color).toBe("#7df9ff"); expect(n.accent).toBe("#ff4fc8"); expect(n.background).toBeNull();
    const c = menuStyle({ look: "chalk", font: "caveat", accent: "#a0e0ff" });
    expect(c.fontId).toBe("caveat"); expect(c.color).toBe("#f2efe6"); expect(c.accent).toBe("#a0e0ff");
    expect(menuStyle({ look: "disco" }).look).toBe("standard");
  });
  it("фон оформлення: перший за замовчуванням, чужий для оформлення не приймається", () => {
    expect(menuStyle({ look: "neon" }).surface).toBe("brick");
    expect(menuStyle({ look: "neon", surface: "wood" }).surface).toBe("wood");
    expect(menuStyle({ look: "chalk", surface: "wood" }).surface).toBe("green");
    expect(menuStyle({ look: "chalk", surface: "slate" }).surface).toBe("slate");
    expect(menuStyle({ surface: "wood" }).surface).toBeNull();
  });
  it("неонова рамка лише в неоні", () => {
    expect(menuStyle({ look: "neon" }).frame).toBe("none");
    expect(menuStyle({ look: "neon", frame: "double" }).frame).toBe("double");
    expect(menuStyle({ look: "neon", frame: "zigzag" }).frame).toBe("none");
    expect(menuStyle({ look: "chalk", frame: "single" }).frame).toBe("none");
  });
  it("неонова вивіска: до 4 рядків, Pacifico і рожевий за замовчуванням, без картки — без стіни", () => {
    const s = neonSignStyle({ text: "  Кавʼярня \n\n«Сонце»\n3\n4\n5" });
    expect(s.lines).toEqual(["Кав’ярня", "«Сонце»", "3", "4"]);
    expect(s.fontId).toBe("pacifico"); expect(s.color).toBe("#ff4fc8"); expect(s.surface).toBe("brick"); expect(s.flicker).toBe("soft");
    expect(neonSignStyle({}).lines).toEqual(["Назва закладу"]);
    expect(neonSignStyle({ card: false, surface: "wood" }).surface).toBeNull();
    expect(neonSignStyle({ font: "lobster", flicker: "broken", frame: true })).toMatchObject({ fontId: "lobster", flicker: "broken", frame: true });
  });
  it("hexToRgba", () => { expect(hexToRgba("#ffb347", 1)).toBe("rgba(255, 179, 71, 1)"); });
});
