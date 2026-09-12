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
export const jobStatus = pgEnum("job_status", ["queued", "running", "done", "failed"]);

// Таблиці Better Auth (згенеровано: pnpm exec better-auth generate)
import { user, session, account, verification } from "./auth-schema.ts";
export { user, session, account, verification };

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  limits: jsonb("limits").$type<PlanLimits>().notNull(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  planId: text("plan_id").notNull().references(() => plans.id).default("free"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const schema = {
  user, session, account, verification, plans, organizations, memberships, invites, inverterModels, devices,
  telemetryRaw, telemetry, deviceState, backgrounds, transcodeJobs, screens, firmware, loggerFrames,
};
export { sql };
