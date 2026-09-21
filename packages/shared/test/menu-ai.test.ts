import { describe, it, expect } from "vitest";
import { parseVisionMenu, extractJson, dishPrompt, CONFIDENCE_OK } from "../src/menu-ai.ts";

const GOOD = JSON.stringify({
  sections: [
    { name: "Кава", items: [
      { name: "Еспресо", description: null, price: "45", volume: "30 мл", confidence: 0.97 },
      { name: "Лате", description: "на вівсяному за бажанням", price: "70 грн", volume: "0,25 л", confidence: 0.82 },
    ] },
    { name: "Десерти", items: [{ name: "Чізкейк", price: 95, volume: "120 г" }] },
  ],
});

describe("розбір відповіді vision-моделі", () => {
  it("ціни в копійках, обʼєми нормалізовані, confidence збережено", () => {
    const s = parseVisionMenu(GOOD);
    expect(s.map((x) => x.name)).toEqual(["Кава", "Десерти"]);
    expect(s[0]!.items[0]).toEqual({ name: "Еспресо", description: null, price: 4500, volume: "30 мл", confidence: 0.97 });
    expect(s[0]!.items[1]).toMatchObject({ price: 7000, volume: "250 мл", description: "на вівсяному за бажанням" });
    // без оцінки моделі — позиція має потрапити під перевірку
    expect(s[1]!.items[0]!.confidence).toBeLessThan(CONFIDENCE_OK);
    expect(s[1]!.items[0]!.price).toBe(9500);
  });

  it("переживає markdown-огорожу і балаканину навколо JSON", () => {
    expect(parseVisionMenu("Ось меню:\n```json\n" + GOOD + "\n```\nГотово!")[0]!.items.length).toBe(2);
    expect(parseVisionMenu("Звісно! " + GOOD)[0]!.name).toBe("Кава");
  });

  it("приймає масив розділів і обгортку menu", () => {
    const sections = JSON.parse(GOOD).sections;
    expect(parseVisionMenu(JSON.stringify(sections))[0]!.name).toBe("Кава");
    expect(parseVisionMenu(JSON.stringify({ menu: { sections } }))[1]!.name).toBe("Десерти");
  });

  it("сміття в ціні не ламає позицію, але знижує впевненість", () => {
    const s = parseVisionMenu(JSON.stringify({ sections: [{ name: "Бар", items: [
      { name: "Вино", price: "за запитом", confidence: 0.99 },
      { name: "Пиво", price: null, confidence: 0.95 },
    ] }] }));
    expect(s[0]!.items[0]).toMatchObject({ price: null, confidence: 0.5 });
    expect(s[0]!.items[1]).toMatchObject({ price: null, confidence: 0.95 });   // ціни не було й на фото
  });

  it("порожнє й безназвене відкидається, зовсім не те — помилка", () => {
    const s = parseVisionMenu(JSON.stringify({ sections: [
      { name: "Порожній", items: [] },
      { name: null, items: [{ name: "  " }, { name: "Борщ", price: "120" }] },
    ] }));
    expect(s).toHaveLength(1);
    expect(s[0]!.name).toBe("Меню");
    expect(s[0]!.items).toHaveLength(1);
    expect(() => parseVisionMenu("вибачте, не бачу меню")).toThrow(/не JSON/);
    expect(() => parseVisionMenu(JSON.stringify({ items: [] }))).toThrow(/структура/);
    expect(() => parseVisionMenu(JSON.stringify({ sections: [] }))).toThrow(/не знайдено/);
  });

  it("extractJson повертає обʼєкт як є", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("промпт фото страви", () => {
  const style = { prompt: "Апетитне фото страви, мʼяке світло.", bgMode: "solid", bgColor: "#f2ece3" };
  it("стиль + назва + опис, завжди без тексту і з квадратним кадром", () => {
    const p = dishPrompt(style, { name: "Лате", description: "на вівсяному" });
    expect(p).toContain("Апетитне фото страви, мʼяке світло");
    expect(p).toContain("Лате, на вівсяному");
    expect(p).toContain("#f2ece3");
    expect(p).toContain("1:1");
    expect(p).toContain("no text, no letters");
  });
  it("прозоре тло описується словами, без опису — лише назва", () => {
    const p = dishPrompt({ ...style, bgMode: "transparent" }, { name: "Чізкейк" });
    expect(p).toContain("однотонне світле тло");
    expect(p).toContain("Чізкейк.");
  });
});
