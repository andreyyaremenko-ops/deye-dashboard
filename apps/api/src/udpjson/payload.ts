/**
 * Готові метрики в JSON по UDP (ESP32 біля інвертора Anenji рахує все сам).
 *
 * Пристрій шле кожні 10 с один рядок:
 * {"device":"b0cbd8c7e750","ac_pow":269.0,"grid_w":0.0,"grid_v":0.0,"load_w":252.0,
 *  "bat_v":53.3,"bat_a":-5.6,"pv_v":0.0,"pv_a":0.0,"pv_w":0.0,"ti":22.0,"td":19.0,"bc":92}
 *
 * Знак струму батареї в цій прошивці протилежний нашому: там мінус = розряд, у нас
 * мінус = заряд (як у Deye). Тому bat_a перевертаємо, і далі bat_w = bat_v * bat_a
 * виходить додатним на розряді — так, як цього чекають екран і кабінет.
 */
import { z } from "zod";
import type { Metrics } from "@deye/register-maps";
import { sha256hex } from "../lib/crypto.ts";

/** Невідомі ключі не ламають розбір: прошивка може додати поле, і це не причина втрачати пакет. */
export const udpPayloadSchema = z.object({
  device: z.string().min(4).max(64),
  ac_pow: z.number().finite().optional(),   // ВА на виході інвертора
  load_w: z.number().finite().optional(),   // фактичне споживання, Вт
  grid_w: z.number().finite().optional(),
  grid_v: z.number().finite().optional(),
  bat_v: z.number().finite().optional(),
  bat_a: z.number().finite().optional(),    // мінус = розряд (у нас навпаки)
  pv_v: z.number().finite().optional(),
  pv_a: z.number().finite().optional(),
  pv_w: z.number().finite().optional(),
  ti: z.number().finite().optional(),       // радіатор силової частини
  td: z.number().finite().optional(),       // сонячний контролер (DC-DC)
  bc: z.number().finite().optional(),       // заряд батареї, %
}).loose();

export type UdpPayload = z.infer<typeof udpPayloadSchema>;

/** Поля, які переносяться один в один (лише назва інша). */
const DIRECT: [keyof UdpPayload, string][] = [
  ["load_w", "load_w"], ["grid_w", "grid_w"], ["grid_v", "grid_v_l1"],
  ["bat_v", "bat_v"], ["pv_v", "pv1_v"], ["pv_a", "pv1_a"],
  ["ti", "temp_heatsink_c"], ["td", "temp_dc_c"], ["bc", "bat_soc"],
  ["ac_pow", "load_va"],
];

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Лічильники енергії приходять уже в наших назвах (pv_day_kwh, load_total_kwh, …) і йдуть як є:
 * за ними «за добу», графік по днях і місячна статистика. Ловимо за шаблоном, а не списком,
 * щоб нове джерело (gen, bat_charge) підхоплювалось без зміни сервера.
 */
const COUNTER = /^(pv|load|grid_buy|grid_sell|gen|bat_charge|bat_discharge)_(day|total)_kwh$/;

/** id пристрою: MAC уже у нашому форматі (12 hex), будь-яке інше імʼя — через хеш. */
export function udpDeviceId(name: string): string {
  const mac = name.trim().toLowerCase();
  return /^[0-9a-f]{12}$/.test(mac) ? mac : sha256hex(`udp:${name.trim()}`).slice(0, 12);
}

/** Останні 8 символів id — код привʼязки в кабінеті (у MAC немає ні O, ні I). */
export const udpClaimCode = (deviceId: string) => deviceId.slice(-8).toUpperCase();

export function toMetrics(p: UdpPayload): Metrics {
  const m: Metrics = {};
  for (const [from, to] of DIRECT) {
    const v = p[from];
    if (typeof v === "number") m[to] = round(v);
  }
  if (typeof p.pv_w === "number") { m.pv_w = round(p.pv_w); m.pv1_w = round(p.pv_w); }
  for (const [k, v] of Object.entries(p)) {
    if (COUNTER.test(k) && typeof v === "number" && Number.isFinite(v) && v >= 0) m[k] = round(v);
  }
  if (typeof p.bat_a === "number") {
    const a = round(-p.bat_a);                       // наш знак: мінус = заряд
    m.bat_a = a;
    if (typeof p.bat_v === "number") m.bat_w = round(p.bat_v * a);
  }
  return m;
}
