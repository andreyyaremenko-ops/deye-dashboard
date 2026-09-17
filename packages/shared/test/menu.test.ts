import { describe, it, expect } from "vitest";
import { menuStyle, hexToRgba, MENU_FONT_SIZE } from "../src/menu.ts";

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
  it("hexToRgba", () => { expect(hexToRgba("#ffb347", 1)).toBe("rgba(255, 179, 71, 1)"); });
});
