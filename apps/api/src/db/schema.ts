/**
 * Схема БД (див. docs/STAGE1.md). Таблиці Better Auth (user, session, account,
 * verification) додаються в етапі 2 через її CLI; тут посилання на "user".id як text.
 */
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, text, uuid, jsonb, timestamp, boolean, integer, bigint,
  doublePrecision, customType, primaryKey, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { PlanLimits, ScreenConfig } from "@deye/shared";
import type { RegisterField, RegisterMap } from "@deye/register-maps";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const orgRole = pgEnum("org_role", ["owner", "admin", "staff"]);
export const backgroundStatus = pgEnum("background_status", ["uploaded", "processing", "ready", "failed"]);
export const backgroundKind = pgEnum("background_kind", ["video", "image"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed"]);

// Таблиці Better Auth (згенеровано: pnpm exec better-auth generate)
import { user, session, account, verification } from "./auth-schema.ts";
export { user, session, account, verification };

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  limits: jsonb("limits").$type<PlanLimits>().notNull(),
  priceMonth: integer("price_month"),        // копійки за місяць; null = не продається онлайн
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  planId: text("plan_id").notNull().references(() => plans.id).default("free"),
  planUntil: timestamp("plan_until", { withTimezone: true }),   // оплачено до; null = безстроково (free або вручну)
  reminderSentFor: timestamp("reminder_sent_for", { withTimezone: true }), // для якого plan_until уже надіслано нагадування
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentStatus = pgEnum("payment_status", ["created", "processing", "hold", "success", "failure", "reversed", "expired"]);

// Платежі через monobank acquiring: один інвойс = один запис
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  planId: text("plan_id").notNull().references(() => plans.id),
  months: integer("months").notNull(),
  amount: integer("amount").notNull(),      // копійки
  ccy: integer("ccy").notNull().default(980),
  invoiceId: text("invoice_id").unique(),
  pageUrl: text("page_url"),
  status: paymentStatus("status").notNull().default("created"),
  failureReason: text("failure_reason"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),   // коли підписку продовжено (ідемпотентність вебхука)
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("payments_org_idx").on(t.orgId)]);

export const memberships = pgTable("memberships", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: orgRole("role").notNull().default("staff"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.userId] })]);

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  role: orgRole("role").notNull().default("staff"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdBy: text("created_by").notNull().references(() => user.id),
});

export const inverterModels = pgTable("inverter_models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  deviceType: integer("device_type").notNull(),
  pollRanges: jsonb("poll_ranges").$type<[number, number][]>().notNull(),
  registerMap: jsonb("register_map").$type<RegisterField[]>().notNull(),
  derived: jsonb("derived").$type<NonNullable<RegisterMap["derived"]>>().notNull().default([]),
});

export const devices = pgTable("devices", {
  id: text("id").primaryKey(),                       // з MAC чипа
  secretHash: text("secret_hash").notNull(),
  claimCodeHash: text("claim_code_hash").notNull(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
  name: text("name"),
  hw: text("hw"),
  fw: text("fw"),
  stickSerial: bigint("stick_serial", { mode: "number" }),
  inverterSerial: text("inverter_serial"),
  inverterType: integer("inverter_type"),
  modelId: text("model_id").references(() => inverterModels.id),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  online: boolean("online").notNull().default(false),
  fwChannel: text("fw_channel").notNull().default("stable"),   // stable | beta
  batteryKwh: doublePrecision("battery_kwh"),                  // ємність батареї для прогнозу часу роботи
  minSoc: integer("min_soc").notNull().default(20),            // нижче не розряджаємо (налаштування інвертора)
  pvKwp: doublePrecision("pv_kwp"),                            // потужність сонячної станції для прогнозу за погодою
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("devices_org_idx").on(t.orgId)]);

// Образи прошивок для OTA. Файл лежить у /media/firmware, підписаний приватним ключем збірки.
export const firmware = pgTable("firmware", {
  id: uuid("id").primaryKey().defaultRandom(),
  hw: text("hw").notNull(),                 // esp8266 | esp32
  channel: text("channel").notNull(),       // stable | beta
  version: text("version").notNull(),       // semver-подібний рядок, порівнюється як рядок з датою
  file: text("file").notNull(),             // firmware/esp8266-0.2.0.bin.signed
  sha256: text("sha256").notNull(),
  size: integer("size").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("firmware_hw_channel_version_idx").on(t.hw, t.channel, t.version)]);

// Hypertable (create_hypertable у custom-міграції 0001)
export const telemetryRaw = pgTable("telemetry_raw", {
  time: timestamp("time", { withTimezone: true }).notNull(),
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  startReg: integer("start_reg").notNull(),
  regs: bytea("regs").notNull(),
}, (t) => [index("telemetry_raw_device_time_idx").on(t.deviceId, t.time.desc())]);

// Hypertable
export const telemetry = pgTable("telemetry", {
  time: timestamp("time", { withTimezone: true }).notNull(),
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  value: doublePrecision("value").notNull(),
}, (t) => [index("telemetry_device_metric_time_idx").on(t.deviceId, t.metric, t.time.desc())]);

// Лічильники "всього" на початок місяця: місячна статистика без історії (free-тариф зберігає 2 дні).
export const deviceCounters = pgTable("device_counters", {
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  month: text("month").notNull(),                       // YYYY-MM за Europe/Kyiv
  counters: jsonb("counters").$type<Record<string, number>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.deviceId, t.month] })]);

export const deviceState = pgTable("device_state", {
  deviceId: text("device_id").primaryKey().references(() => devices.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  state: jsonb("state").$type<Record<string, number | string | boolean>>().notNull(),
});

export const backgrounds = pgTable("backgrounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }), // null = стандартний
  name: text("name").notNull(),
  category: text("category"),
  license: text("license"),
  source: text("source"),
  status: backgroundStatus("status").notNull().default("ready"),
  kind: backgroundKind("kind").notNull().default("video"),   // image: files = jpg 1080/720, показується як кадр
  files: jsonb("files").$type<Record<"1080" | "720", string>>(),
  preview: text("preview"),
  sourceFile: text("source_file"),          // оригінал у /media до транскодування
  attribution: text("attribution"),         // автор (Pexels)
  durationS: integer("duration_s"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("backgrounds_org_idx").on(t.orgId)]);

export const transcodeJobs = pgTable("transcode_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  backgroundId: uuid("background_id").notNull().references(() => backgrounds.id, { onDelete: "cascade" }),
  status: jobStatus("status").notNull().default("queued"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const screens = pgTable("screens", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: jsonb("config").$type<ScreenConfig>().notNull(),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),   // останнє підключення ТБ по WS
  viewToken: text("view_token").notNull(),
  pairCode: text("pair_code"),                                       // 6 цифр для введення на ТБ
  pairCodeExpiresAt: timestamp("pair_code_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("screens_view_token_idx").on(t.viewToken), uniqueIndex("screens_pair_code_idx").on(t.pairCode), index("screens_org_idx").on(t.orgId)]);

// Сирі кадри від Solarman-стіків у режимі push (Server B). Для аналізу протоколу і перепарсингу.
export const loggerFrames = pgTable("logger_frames", {
  id: uuid("id").primaryKey().defaultRandom(),
  serial: bigint("serial", { mode: "number" }).notNull(),
  control: integer("control").notNull(),        // 0x4110 hello, 0x4210 data, 0x4710 heartbeat...
  frame: bytea("frame").notNull(),
  remoteIp: text("remote_ip"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("logger_frames_serial_time_idx").on(t.serial, t.receivedAt.desc())]);

/** Власні радіостанції закладу: у редакторі екрана йдуть поруч із каталогом RADIO_STATIONS. */
export const radioStations = pgTable("radio_stations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").notNull(),               // прямий стрім (після розгортання плейлиста) — саме він іде в radioUrl екрана
  sourceUrl: text("source_url").notNull(),  // що вставив користувач (може бути .m3u/.pls)
  contentType: text("content_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("radio_stations_org_url_idx").on(t.orgId, t.url)]);

// --- AI-меню: розпізнане з фото меню закладу + згенеровані фото страв ---

export const menuStatus = pgEnum("menu_status", ["importing", "draft", "published"]);
export const dishImageStatus = pgEnum("dish_image_status", ["queued", "ready", "failed"]);
export const aiJobKind = pgEnum("ai_job_kind", ["menu_import", "dish_image", "dish_upload"]);   // dish_upload — власне фото: те саме оброблення, без AI

/** Стиль закладу: один шаблон промпту на всі страви, щоб фото виглядали як одна серія. */
export const menuStyles = pgTable("menu_styles", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  bgMode: text("bg_mode").notNull().default("solid"),     // solid | transparent
  bgColor: text("bg_color"),                              // #rrggbb для solid
  imageProvider: text("image_provider").notNull().default("xai"),    // IMAGE_PROVIDERS у @deye/shared/menu-ai
  imageModel: text("image_model").notNull().default("grok-imagine-image-2.0"),
  imageQuality: text("image_quality").notNull().default("medium"),   // low | medium | high (для OpenAI)
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("menu_styles_org_idx").on(t.orgId)]);

export const menus = pgTable("menus", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  styleId: uuid("style_id").references(() => menuStyles.id, { onDelete: "set null" }),
  status: menuStatus("status").notNull().default("draft"),   // importing -> draft (перевірка) -> published
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("menus_org_idx").on(t.orgId)]);

export const menuSections = pgTable("menu_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  menuId: uuid("menu_id").notNull().references(() => menus.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("menu_sections_menu_idx").on(t.menuId, t.sort)]);

export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  menuId: uuid("menu_id").notNull().references(() => menus.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => menuSections.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  price: integer("price"),                 // копійки; null = «за запитом»
  volume: text("volume"),                  // «250 мл», «300 г»
  sort: integer("sort").notNull().default(0),
  inStock: boolean("in_stock").notNull().default(true),
  imageId: uuid("image_id"),               // обране фото з dish_images; без FK — dish_images вже посилається сюди
  imageIsAi: boolean("image_is_ai").notNull().default(false),
  confidence: doublePrecision("confidence"),   // від vision-моделі; null після ручного правлення
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("menu_items_menu_idx").on(t.menuId), index("menu_items_section_idx").on(t.sectionId, t.sort)]);

/** Варіанти фото страви (AI або завантажене власне). Файли в /media/dish, роздаються Caddy. */
export const dishImages = pgTable("dish_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => menuItems.id, { onDelete: "cascade" }),
  status: dishImageStatus("status").notNull().default("ready"),
  file: text("file"),                      // dish/<id>.jpg відносно MEDIA_ROOT
  thumb: text("thumb"),
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes"),
  isAi: boolean("is_ai").notNull().default(true),
  provider: text("provider"),
  model: text("model"),
  prompt: text("prompt"),
  seed: bigint("seed", { mode: "number" }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("dish_images_item_idx").on(t.itemId), index("dish_images_org_idx").on(t.orgId)]);

/** Черга AI-задач (той самий патерн, що transcode_jobs): воркер бере FOR UPDATE SKIP LOCKED. */
export const aiJobs = pgTable("ai_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: aiJobKind("kind").notNull(),
  refId: uuid("ref_id"),                   // menu_id для menu_import, menu_item_id для dish_image
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: jobStatus("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("ai_jobs_queue_idx").on(t.status, t.createdAt), index("ai_jobs_org_idx").on(t.orgId), index("ai_jobs_ref_idx").on(t.refId)]);

/** Леджер вартості AI: і облік грошей, і база для місячних лімітів тарифу. */
export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => aiJobs.id, { onDelete: "set null" }),
  kind: aiJobKind("kind").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  images: integer("images").notNull().default(0),
  costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),   // мільйонні долара
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ai_usage_org_time_idx").on(t.orgId, t.createdAt.desc())]);

export const schema = {
  user, session, account, verification, plans, organizations, memberships, invites, inverterModels, devices,
  telemetryRaw, telemetry, deviceState, deviceCounters, backgrounds, transcodeJobs, screens, firmware, loggerFrames, payments,
  menuStyles, menus, menuSections, menuItems, dishImages, aiJobs, aiUsage, radioStations,
};
export { sql };
