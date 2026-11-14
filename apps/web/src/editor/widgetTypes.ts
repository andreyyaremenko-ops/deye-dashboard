/** Каталог віджетів редактора: підпис, розмір за замовчуванням, чи потрібен пристрій/локація, стартові props. */
import type { ScreenConfig } from "@deye/shared";
import { MENU_FONT_SIZE } from "@deye/shared/menu";

export type Widget = ScreenConfig["widgets"][number];
export type WidgetType = Widget["type"];

/** Групи в «Додати віджет», у порядку показу. */
export const WIDGET_GROUPS = [["energy", "Енергія"], ["info", "Інформація"], ["venue", "Заклад"], ["media", "Медіа"]] as const;
export type WidgetGroup = (typeof WIDGET_GROUPS)[number][0];

export interface WidgetKind {
  t: WidgetType;
  group: WidgetGroup;
  label: string;
  needsDevice: boolean;
  /** пристрій не обовʼязковий, але корисний (погода: прогноз генерації за kWp станції) */
  optionalDevice?: boolean;
  w: number; h: number;
  /** кілька кнопок одного типу (QR / Wi-Fi) — унікальний ключ */
  key?: string;
  needsLocation?: boolean;
  props?: Record<string, unknown>;
}

export const WIDGET_KINDS: WidgetKind[] = [
  { t: "pv", group: "energy", label: "Сонце", needsDevice: true, w: 22, h: 18 },
  { t: "battery", group: "energy", label: "Батарея", needsDevice: true, w: 22, h: 20 },
  { t: "grid", group: "energy", label: "Мережа", needsDevice: true, w: 22, h: 18 },
  { t: "load", group: "energy", label: "Споживання", needsDevice: true, w: 22, h: 18 },
  { t: "flow", group: "energy", label: "Потік енергії", needsDevice: true, w: 30, h: 42, props: { skin: "orbit", card: true } },
  { t: "mppt", group: "energy", label: "Стрінги (MPPT)", needsDevice: true, w: 34, h: 30, props: { showVA: true } },
  { t: "energy_today", group: "energy", label: "Підсумок дня", needsDevice: true, w: 22, h: 26 },
  { t: "runtime", group: "energy", label: "Автономія", needsDevice: true, w: 22, h: 18 },
  { t: "chart", group: "energy", label: "Графік доби", needsDevice: true, w: 44, h: 30 },
  { t: "outage", group: "energy", label: "Банер відключення", needsDevice: true, w: 44, h: 14, props: { hideWhenOk: true, note: "" } },
  { t: "outage_schedule", group: "info", label: "Графік відключень", needsDevice: false, w: 40, h: 28, props: { region: "kyiv-region", group: "1.1", card: true } },
  { t: "eco", group: "energy", label: "Еко-статистика", needsDevice: true, w: 22, h: 26 },
  { t: "weather", group: "info", label: "Погода", needsDevice: false, optionalDevice: true, w: 24, h: 26, needsLocation: true },
  { t: "alert", group: "info", label: "Тривога", needsDevice: false, w: 22, h: 16, needsLocation: true, props: { overlay: true } },
  { t: "qr", group: "venue", label: "QR-код", needsDevice: false, w: 14, h: 30, props: { mode: "url", url: "https://instagram.com/", caption: "Ми в Instagram", card: true } },
  { t: "qr", group: "venue", label: "Wi-Fi для гостей", needsDevice: false, w: 14, h: 32, key: "wifi", props: { mode: "wifi", ssid: "", password: "", auth: "WPA", caption: "Wi-Fi для гостей", card: true, showPassword: true } },
  { t: "camera", group: "media", label: "Камери", needsDevice: false, w: 44, h: 34, props: { cameras: [], rotateS: 20, fit: "cover", quality: "sub", card: true } },
  { t: "spectrum", group: "media", label: "Візуалізація звуку", needsDevice: false, w: 34, h: 26, props: { mode: "bars", theme: "ember", sensitivity: 0.8, showName: true, card: true } },
  { t: "neon_sign", group: "venue", label: "Неонова вивіска", needsDevice: false, w: 100, h: 100, props: { text: "Назва закладу", sub: "", font: "pacifico", color: "#ff4fc8", subColor: "#7df9ff", surface: "brick", flicker: "soft", frame: false, card: true } },
  { t: "live", group: "media", label: "Пряма трансляція", needsDevice: false, w: 50, h: 50, props: { pathId: "", name: "", sound: true, fit: "contain", whenOff: "card", card: true } },
  { t: "web", group: "media", label: "Вебсторінка", needsDevice: false, w: 100, h: 100, props: { url: "", refreshMin: 0 } },
  { t: "clock", group: "info", label: "Годинник", needsDevice: false, w: 22, h: 16 },
  { t: "menu", group: "venue", label: "Меню закладу (AI)", needsDevice: false, w: 46, h: 62, props: { menuId: "", title: "", font: "system", fontSize: MENU_FONT_SIZE.default, photos: true, columns: 0, sectionS: 15, outOfStock: "hide", card: true } },
  { t: "text", group: "venue", label: "Меню / текст", needsDevice: false, w: 28, h: 50, props: { title: "Меню", text: "Еспресо — 45\nКапучино — 65\nЛате — 70\n# Десерти\nЧізкейк — 95", font: "system", fontSize: MENU_FONT_SIZE.default, align: "left", card: true } },
];

export const kindOf = (t: WidgetType) => WIDGET_KINDS.find((k) => k.t === t);
export const labelOf = (t: WidgetType) => kindOf(t)?.label ?? t;

/** Новий віджет: розкладка сіткою 3 у ряд, щоб нові не лягали один на одного. */
export function newWidget(kind: WidgetKind, index: number, deviceId?: string): Widget {
  const id = `${kind.t}-${Math.random().toString(36).slice(2, 7)}`;
  return { id, type: kind.t, x: 3 + (index % 3) * 25, y: 4 + Math.floor(index / 3) * 24, w: kind.w, h: kind.h, deviceId: kind.needsDevice || kind.optionalDevice ? deviceId : undefined, props: { ...(kind.props ?? {}) } };
}
