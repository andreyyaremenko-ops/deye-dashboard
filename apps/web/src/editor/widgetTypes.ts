/** Каталог віджетів редактора: підпис, розмір за замовчуванням, чи потрібен пристрій/локація, стартові props. */
import type { ScreenConfig } from "@deye/shared";
import { MENU_FONT_SIZE } from "@deye/shared/menu";

export type Widget = ScreenConfig["widgets"][number];
export type WidgetType = Widget["type"];

export interface WidgetKind {
  t: WidgetType;
  label: string;
  needsDevice: boolean;
  w: number; h: number;
  /** кілька кнопок одного типу (QR / Wi-Fi) — унікальний ключ */
  key?: string;
  needsLocation?: boolean;
  props?: Record<string, unknown>;
}

export const WIDGET_KINDS: WidgetKind[] = [
  { t: "pv", label: "Сонце", needsDevice: true, w: 22, h: 18 },
  { t: "battery", label: "Батарея", needsDevice: true, w: 22, h: 20 },
  { t: "grid", label: "Мережа", needsDevice: true, w: 22, h: 18 },
  { t: "load", label: "Споживання", needsDevice: true, w: 22, h: 18 },
  { t: "flow", label: "Потік енергії", needsDevice: true, w: 30, h: 42, props: { skin: "orbit", card: true } },
  { t: "energy_today", label: "Підсумок дня", needsDevice: true, w: 22, h: 26 },
  { t: "runtime", label: "Автономія", needsDevice: true, w: 22, h: 18 },
  { t: "chart", label: "Графік доби", needsDevice: true, w: 44, h: 30 },
  { t: "outage", label: "Банер відключення", needsDevice: true, w: 44, h: 14, props: { hideWhenOk: true, note: "" } },
  { t: "eco", label: "Еко-статистика", needsDevice: true, w: 22, h: 26 },
  { t: "weather", label: "Погода", needsDevice: true, w: 24, h: 26, needsLocation: true },
  { t: "alert", label: "Тривога", needsDevice: false, w: 22, h: 16, needsLocation: true, props: { overlay: true } },
  { t: "qr", label: "QR-код", needsDevice: false, w: 14, h: 30, props: { mode: "url", url: "https://instagram.com/", caption: "Ми в Instagram", card: true } },
  { t: "qr", label: "Wi-Fi для гостей", needsDevice: false, w: 14, h: 32, key: "wifi", props: { mode: "wifi", ssid: "", password: "", auth: "WPA", caption: "Wi-Fi для гостей", card: true, showPassword: true } },
  { t: "clock", label: "Годинник", needsDevice: false, w: 22, h: 16 },
  { t: "text", label: "Меню / текст", needsDevice: false, w: 28, h: 50, props: { title: "Меню", text: "Еспресо — 45\nКапучино — 65\nЛате — 70\n# Десерти\nЧізкейк — 95", font: "system", fontSize: MENU_FONT_SIZE.default, align: "left", card: true } },
];

export const kindOf = (t: WidgetType) => WIDGET_KINDS.find((k) => k.t === t);
export const labelOf = (t: WidgetType) => kindOf(t)?.label ?? t;

/** Новий віджет: розкладка сіткою 3 у ряд, щоб нові не лягали один на одного. */
export function newWidget(kind: WidgetKind, index: number, deviceId?: string): Widget {
  const id = `${kind.t}-${Math.random().toString(36).slice(2, 7)}`;
  return { id, type: kind.t, x: 3 + (index % 3) * 25, y: 4 + Math.floor(index / 3) * 24, w: kind.w, h: kind.h, deviceId: kind.needsDevice ? deviceId : undefined, props: { ...(kind.props ?? {}) } };
}
