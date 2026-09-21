import { z } from "zod";

/** Payload з пристрою: devices/<id>/telemetry (див. firmware/README.md). */
export const telemetryRangeSchema = z.object({
  start: z.number().int().min(0).max(65535),
  /** 4 hex-символи на регістр, big-endian */
  regs: z.string().regex(/^([0-9a-f]{4})+$/),
});
export const telemetryPayloadSchema = z.object({
  seq: z.number().int(),
  ts: z.number().int(), // epoch або 0, якщо NTP ще не синхронізувався
  uptime: z.number().int(),
  stick: z.number().int(),
  ranges: z.array(telemetryRangeSchema).min(1).max(16),
});
export type TelemetryPayload = z.infer<typeof telemetryPayloadSchema>;

/** devices/<id>/info (retained) */
export const deviceInfoSchema = z.object({
  fw: z.string(),
  hw: z.string(),
  ip: z.string(),
  rssi: z.number(),
  stick_ip: z.string(),
  stick_serial: z.number(),
  uptime: z.number(),
  heap: z.number(),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

/** devices/<id>/cfg (retained, сервер -> пристрій) */
export const deviceCfgSchema = z.object({
  ranges: z.array(z.tuple([z.number().int(), z.number().int()])).min(1).max(8),
  interval: z.number().int().min(2).max(600),
  channel: z.enum(["stable", "beta"]).default("stable"),
});
export type DeviceCfg = z.infer<typeof deviceCfgSchema>;

export const orgRoles = ["owner", "admin", "staff"] as const;
export type OrgRole = (typeof orgRoles)[number];

/** Конфіг екрана для ТБ */
export const widgetSchema = z.object({
  id: z.string(),
  type: z.enum(["pv", "battery", "grid", "load", "energy_today", "clock", "text", "chart", "qr", "runtime", "weather", "alert", "eco", "outage", "flow", "mppt", "menu"]),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(1).max(100),
  h: z.number().min(1).max(100),
  deviceId: z.string().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
});
/** Локація екрана: для погоди (координати) і тривог (область як у джерелі, напр. "Київська область", "м. Київ"). */
export const screenLocationSchema = z.object({
  name: z.string().min(1).max(100),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  oblast: z.string().max(60).nullable().default(null),
});
export type ScreenLocation = z.infer<typeof screenLocationSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Сцена: повний вигляд екрана (фон, тема, віджети) + скільки секунд показувати і коли. */
export const sceneSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().max(60).default(""),
  durationS: z.number().int().min(5).max(3600).default(30),
  backgroundId: z.string().uuid().nullable().default(null),
  theme: z.enum(["dark", "light"]).default("dark"),
  widgets: z.array(widgetSchema).default([]),
  /** показувати лише в ці години (локальний час ТБ); null — завжди */
  schedule: z.object({ from: hhmm, to: hhmm }).nullable().default(null),
  /** під час відключення світла показувати лише такі сцени */
  onOutage: z.boolean().default(false),
});
export type Scene = z.infer<typeof sceneSchema>;

const screenConfigBase = z.object({
  backgroundId: z.string().uuid().nullable(),
  location: screenLocationSchema.nullable().default(null),
  widgets: z.array(widgetSchema),
  radioUrl: z.string().url().nullable(),
  radioVolume: z.number().min(0).max(1).default(0.6),
  /** Samsung Tizen грає лише один медіаелемент: auto — визначати, poster — кадр замість відео при радіо, always — завжди відео */
  tvVideo: z.enum(["auto", "always", "poster"]).default("auto"),
  theme: z.enum(["dark", "light"]).default("dark"),
  /** Кілька сцен на один телевізор (одне посилання). Порожньо у старих екранів -> одна сцена з полів верхнього рівня. */
  scenes: z.array(sceneSchema).max(10).default([]),
  rotation: z.enum(["sequence", "random"]).default("sequence"),
});
/**
 * Після розбору сцени є завжди, а backgroundId/theme/widgets верхнього рівня дзеркалять першу сцену:
 * старі читачі (закешований бандл ТБ, лічильники в адмінці) і далі бачать коректний екран.
 */
export const screenConfigSchema = screenConfigBase.transform((cfg) => {
  const scenes = cfg.scenes.length ? cfg.scenes
    : [{ id: "main", name: "", durationS: 30, backgroundId: cfg.backgroundId, theme: cfg.theme, widgets: cfg.widgets, schedule: null, onOutage: false } satisfies Scene];
  const first = scenes[0]!;
  return { ...cfg, scenes, backgroundId: first.backgroundId, theme: first.theme, widgets: first.widgets };
});
export type ScreenConfig = z.infer<typeof screenConfigSchema>;

/** Ліміти тарифу. Free і Pro мають однаковий функціонал, різниця лише в кількості екранів і логерів. */
export const planLimitsSchema = z.object({
  screens: z.number().int(),
  /** пристроїв (стіків/плат) на організацію */
  devices: z.number().int().default(1),
  custom_backgrounds: z.boolean(),
  history_days: z.number().int(),
  radio: z.boolean(),
  branding: z.boolean(),
  /** меню закладу (AI-меню) на організацію */
  menus: z.number().int().default(1),
  /** скільки страв можуть мати AI-фото */
  ai_dishes: z.number().int().default(20),
  /** генерацій зображень на місяць */
  ai_generations_month: z.number().int().default(60),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

/** plans.limits читається з jsonb без розбору: у старих рядках нових ключів немає — добираємо значення за замовчуванням. */
export function planLimitsOf(raw: unknown): PlanLimits {
  const r = planLimitsSchema.safeParse(raw);
  return r.success ? r.data : planLimitsSchema.parse({ screens: 1, custom_backgrounds: false, history_days: 0, radio: false, branding: true, ...(raw as object ?? {}) });
}

export * from "./radio.ts";
export * from "./chart.ts";
export * from "./energy.ts";
export * from "./brand.ts";
export * from "./feeds.ts";
export * from "./menu.ts";
export * from "./menu-data.ts";
export * from "./flow.ts";
export * from "./scenes.ts";
