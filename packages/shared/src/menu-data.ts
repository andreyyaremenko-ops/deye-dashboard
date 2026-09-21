/**
 * Дані меню закладу (AI-меню): спільні типи для API, кабінету і ТБ + розбір цін/обʼємів.
 * Оформлення (шрифти, кольори) — у ./menu.ts; тут лише вміст.
 * Ціна зберігається цілим числом копійок, як payments.amount.
 */
import { z } from "zod";

export const MAX_PRICE_UAH = 100_000;
export const MAX_PRICE_KOP = MAX_PRICE_UAH * 100;

const CURRENCY = /(грн|uah|₴|\bгр\b)\.?/gi;

/**
 * "45", "45,50", "1 200 грн", "₴45.-" -> копійки; "за запитом", "" -> null.
 * Роздільник тисяч (крапка чи кома перед рівно трьома цифрами) прибирається,
 * решта — десяткова частина. Беремо перше число: "від 45 грн" -> 4500.
 */
export function parsePrice(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 && input <= MAX_PRICE_UAH ? Math.round(input * 100) : null;
  }
  if (typeof input !== "string") return null;
  const cleaned = input
    .replace(CURRENCY, "")
    .replace(/[\s  '’]/g, "")
    .replace(/(\d)[.,](\d{3})(?!\d)/g, "$1$2");   // 1.200 / 1,200 -> 1200
  const m = /\d+(?:[.,]\d{1,2})?/.exec(cleaned);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE_UAH) return null;
  return Math.round(n * 100);
}

/** Копійки -> рядок для екрана: 4500 -> "45", 4550 -> "45,50". */
export function formatPrice(kop: number | null): string {
  if (kop === null || !Number.isFinite(kop)) return "";
  return kop % 100 === 0 ? String(Math.round(kop / 100)) : (kop / 100).toFixed(2).replace(".", ",");
}

const VOLUME = /^(\d+(?:[.,]\d+)?)\s*(л|l|мл|ml|г|g|гр|кг|kg|шт|pcs|pc)\.?$/i;
const UNIT: Record<string, string> = { l: "л", ml: "мл", g: "г", гр: "г", kg: "кг", pcs: "шт", pc: "шт" };

/** "0,25 л" -> "250 мл", "300g" -> "300 г". Незнайоме лишаємо як є (обрізане до 30 символів). */
export function normalizeVolume(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  const m = VOLUME.exec(s);
  if (!m) return s.slice(0, 30);
  const value = Number(m[1]!.replace(",", "."));
  let unit = m[2]!.toLowerCase();
  unit = UNIT[unit] ?? unit;
  if (!Number.isFinite(value)) return s.slice(0, 30);
  if (unit === "л" && value < 1) return `${Math.round(value * 1000)} мл`;
  if (unit === "кг" && value < 1) return `${Math.round(value * 1000)} г`;
  const num = Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
  return `${num} ${unit}`;
}

/** Ціна з форми кабінету: число копійок або рядок ("45,50"). */
export const priceSchema = z.union([
  z.number().int().min(0).max(MAX_PRICE_KOP),
  z.string().transform((s, ctx) => {
    if (!s.trim()) return null;
    const p = parsePrice(s);
    if (p === null) { ctx.addIssue({ code: "custom", message: "Невірна ціна" }); return z.NEVER; }
    return p;
  }),
  z.null(),
]);

export const menuItemInputSchema = z.object({
  sectionId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().default(null),
  price: priceSchema.default(null),
  volume: z.string().trim().max(30).nullable().default(null),
  sort: z.number().int().min(0).max(10_000).optional(),
  inStock: z.boolean().optional(),
});
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

export const menuItemPatchSchema = menuItemInputSchema.partial();
export const menuSectionInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sort: z.number().int().min(0).max(10_000).optional(),
});

export const MENU_STATUSES = ["importing", "draft", "published"] as const;
export type MenuStatus = (typeof MENU_STATUSES)[number];

/** Те, що віддається на ТБ у publicScreen(): лише опубліковане й лише потрібні поля. */
export interface MenuItemPayload {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  volume: string | null;
  inStock: boolean;
  image: string | null;
  imageIsAi: boolean;
}
export interface MenuSectionPayload { id: string; name: string; items: MenuItemPayload[] }
export interface MenuPayload { id: string; name: string; updatedAt: string; sections: MenuSectionPayload[] }
