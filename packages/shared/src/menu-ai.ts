/**
 * Чиста частина AI-меню: промпти й розбір відповіді vision-моделі.
 * Тут немає мережі — провайдер (Grok тощо) живе у воркері, а це тестується без ключів.
 */
import { z } from "zod";
import { normalizeVolume, parsePrice } from "./menu-data.ts";

/** Нижче цього значення поле підсвічується в екрані перевірки. */
export const CONFIDENCE_OK = 0.9;
/** Модель не дала оцінки — вважаємо, що перевірити треба. */
const DEFAULT_CONFIDENCE = 0.5;

export const VISION_SYSTEM = [
  "Ти розпізнаєш паперові меню закладів харчування.",
  "Поверни ЛИШЕ JSON без пояснень і без markdown-огорожі.",
  "Формат: {\"sections\":[{\"name\":\"Розділ\",\"items\":[{\"name\":\"Назва\",\"description\":\"опис або null\",",
  "\"price\":\"45\",\"volume\":\"250 мл\",\"confidence\":0.95}]}]}",
  "Правила: зберігай мову оригіналу і порядок позицій; ціну давай як число або рядок з фото;",
  "якщо ціни немає — null; обʼєм/вагу (мл, л, г) клади в volume, а не в назву;",
  "confidence 0..1 — наскільки впевнено прочитано рядок; нічого не вигадуй, дублікати не додавай.",
].join(" ");

export const VISION_USER = "Розпізнай це меню. Кожна сторінка — окреме фото одного меню.";

const loose = z.union([z.string(), z.number(), z.null()]).optional();
const visionItemSchema = z.object({
  name: z.union([z.string(), z.number()]),
  description: loose,
  price: loose,
  volume: loose,
  confidence: z.union([z.number(), z.string(), z.null()]).optional(),
});
const visionSectionSchema = z.object({ name: loose, items: z.array(visionItemSchema).default([]) });
export const visionMenuSchema = z.object({ sections: z.array(visionSectionSchema) });

export interface DraftItem {
  name: string;
  description: string | null;
  /** копійки або null («за запитом») */
  price: number | null;
  volume: string | null;
  confidence: number;
}
export interface DraftSection { name: string; items: DraftItem[] }

/** Витягує JSON з відповіді моделі: чистий, у ```-огорожі або з балаканиною навколо. */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c); } catch { /* нижче спробуємо вирізати обʼєкт */ }
    const start = c.search(/[[{]/);
    const end = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try { return JSON.parse(c.slice(start, end + 1)); } catch { /* наступний кандидат */ }
    }
  }
  throw new Error("Модель повернула не JSON");
}

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : null;
};

function confidenceOf(item: z.infer<typeof visionItemSchema>, priceRaw: string | null, price: number | null): number {
  const c = Number(item.confidence);
  let v = Number.isFinite(c) && c > 0 && c <= 1 ? c : DEFAULT_CONFIDENCE;
  // ціна на фото була, але прочиталась як сміття — це якраз те, що має перевірити людина
  if (priceRaw && price === null) v = Math.min(v, DEFAULT_CONFIDENCE);
  return Math.round(v * 100) / 100;
}

/**
 * Відповідь vision-моделі -> чернетка меню: ціни в копійках, обʼєми нормалізовані.
 * Кидає помилку, якщо JSON зовсім не той; порожні розділи й позиції без назви просто відкидає.
 */
export function parseVisionMenu(raw: string): DraftSection[] {
  const json = extractJson(raw);
  const asObject = Array.isArray(json) ? { sections: json } : (json as Record<string, unknown>);
  const body = (asObject?.sections ? asObject : (asObject?.menu as Record<string, unknown> | undefined) ?? asObject) as Record<string, unknown>;
  const parsed = visionMenuSchema.safeParse(body);
  if (!parsed.success) throw new Error("Несподівана структура JSON: очікували sections[]");

  const sections: DraftSection[] = [];
  for (const s of parsed.data.sections) {
    const items: DraftItem[] = [];
    for (const i of s.items) {
      const name = str(i.name);
      if (!name) continue;
      const priceRaw = str(i.price);
      const price = parsePrice(typeof i.price === "number" ? i.price : priceRaw);
      items.push({
        name: name.slice(0, 120),
        description: str(i.description)?.slice(0, 500) ?? null,
        price,
        volume: normalizeVolume(str(i.volume)),
        confidence: confidenceOf(i, priceRaw, price),
      });
    }
    if (items.length) sections.push({ name: str(s.name)?.slice(0, 80) ?? "Меню", items });
  }
  if (!sections.length) throw new Error("На фото не знайдено позицій меню");
  return sections;
}

/** Промпт фото страви: стиль закладу + назва + опис; «без тексту» — завжди. */
export function dishPrompt(style: { prompt: string; bgMode?: string | null; bgColor?: string | null }, item: { name: string; description?: string | null }): string {
  const bg = style.bgMode === "transparent"
    ? "однотонне світле тло без предметів"
    : `однотонне тло кольору ${style.bgColor ?? "#f2ece3"} без предметів`;
  return [
    style.prompt.trim().replace(/[.\s]+$/, ""),
    item.name.trim() + (item.description?.trim() ? `, ${item.description.trim()}` : ""),
    bg,
    "квадратний кадр 1:1, страва в центрі",
    "no text, no letters, no words, no labels, no logos, no watermarks, no menu, no people, no hands",
  ].join(". ") + ".";
}
