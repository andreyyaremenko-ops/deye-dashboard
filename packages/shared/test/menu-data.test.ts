import { describe, it, expect } from "vitest";
import { parsePrice, formatPrice, normalizeVolume, menuItemInputSchema, MAX_PRICE_UAH } from "../src/menu-data.ts";

describe("ціни меню", () => {
  it("розбирає те, що реально пишуть у меню", () => {
    expect(parsePrice("45")).toBe(4500);
    expect(parsePrice("45,50")).toBe(4550);
    expect(parsePrice("45.50")).toBe(4550);
    expect(parsePrice("45 грн")).toBe(4500);
    expect(parsePrice("₴45.-")).toBe(4500);
    expect(parsePrice("1 200 грн")).toBe(120000);      // звичайний пробіл
    expect(parsePrice("1 200,00")).toBe(120000);  // нерозривний
    expect(parsePrice("1.200")).toBe(120000);          // крапка як роздільник тисяч
    expect(parsePrice("від 45 грн")).toBe(4500);
    expect(parsePrice(45.5)).toBe(4550);
  });
  it("відкидає те, що ціною не є", () => {
    for (const bad of ["за запитом", "", "—", null, undefined, {}, "999999999", -5]) {
      expect(parsePrice(bad as unknown)).toBeNull();
    }
    expect(parsePrice(String(MAX_PRICE_UAH + 1))).toBeNull();
  });
  it("форматує назад для екрана", () => {
    expect(formatPrice(4500)).toBe("45");
    expect(formatPrice(4550)).toBe("45,50");
    expect(formatPrice(null)).toBe("");
  });
});

describe("обʼєми", () => {
  it("зводить до звичних одиниць", () => {
    expect(normalizeVolume("0,25 л")).toBe("250 мл");
    expect(normalizeVolume("0.33л")).toBe("330 мл");
    expect(normalizeVolume("300g")).toBe("300 г");
    expect(normalizeVolume("1 л")).toBe("1 л");
    expect(normalizeVolume("250 ml")).toBe("250 мл");
    expect(normalizeVolume("2 шт")).toBe("2 шт");
  });
  it("незнайоме лишає як є, порожнє -> null", () => {
    expect(normalizeVolume("велика порція")).toBe("велика порція");
    expect(normalizeVolume("  ")).toBeNull();
    expect(normalizeVolume(42)).toBeNull();
  });
});

describe("валідація позиції меню", () => {
  const sectionId = "11111111-1111-4111-8111-111111111111";
  it("рядкова ціна з форми стає копійками", () => {
    const i = menuItemInputSchema.parse({ sectionId, name: "Лате", price: "70,50" });
    expect(i.price).toBe(7050);
    expect(menuItemInputSchema.parse({ sectionId, name: "Лате", price: "" }).price).toBeNull();
    expect(menuItemInputSchema.parse({ sectionId, name: "Лате" }).price).toBeNull();
  });
  it("сміття в ціні й порожня назва відхиляються", () => {
    expect(menuItemInputSchema.safeParse({ sectionId, name: "Лате", price: "дорого" }).success).toBe(false);
    expect(menuItemInputSchema.safeParse({ sectionId, name: "  " }).success).toBe(false);
    expect(menuItemInputSchema.safeParse({ sectionId, name: "Лате", price: -1 }).success).toBe(false);
    expect(menuItemInputSchema.safeParse({ name: "Лате" }).success).toBe(false);
  });
});
