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
  type: z.enum(["pv", "battery", "grid", "load", "energy_today", "clock", "text", "chart", "qr"]),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  w: z.number().min(1).max(100),
  h: z.number().min(1).max(100),
  deviceId: z.string().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
});
export const screenConfigSchema = z.object({
  backgroundId: z.string().uuid().nullable(),
  widgets: z.array(widgetSchema),
  radioUrl: z.string().url().nullable(),
  radioVolume: z.number().min(0).max(1).default(0.6),
  theme: z.enum(["dark", "light"]).default("dark"),
});
export type ScreenConfig = z.infer<typeof screenConfigSchema>;

export const planLimitsSchema = z.object({
  screens: z.number().int(),
  custom_backgrounds: z.boolean(),
  history_days: z.number().int(),
  radio: z.boolean(),
  branding: z.boolean(),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

export * from "./radio.ts";
export * from "./chart.ts";
export * from "./energy.ts";
