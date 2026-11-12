/**
 * Оформлення віджета «Меню / текст»: шрифти, розмір, кольори. Спільне для ТБ (рендер) і кабінету (редактор, превʼю).
 * Файли шрифтів у apps/tv/public/fonts (Google Fonts, SIL OFL, підмножини cyrillic/latin), @font-face у fonts.css tv і web.
 */
export const MENU_FONTS = [
  { id: "system", label: "Системний", family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: "playfair", label: "Playfair Display — класичний", family: '"Playfair Display", Georgia, serif' },
  { id: "cormorant", label: "Cormorant — елегантний", family: '"Cormorant Garamond", Georgia, serif' },
  { id: "oswald", label: "Oswald — вузький, дошка меню", family: '"Oswald", "Arial Narrow", sans-serif' },
  { id: "montserrat", label: "Montserrat — геометричний", family: '"Montserrat", Arial, sans-serif' },
  { id: "comfortaa", label: "Comfortaa — округлий", family: '"Comfortaa", Arial, sans-serif' },
  { id: "lobster", label: "Lobster — декоративний", family: '"Lobster", cursive' },
  { id: "caveat", label: "Caveat — рукописний", family: '"Caveat", cursive' },
  { id: "marck", label: "Marck Script — рукописний", family: '"Marck Script", cursive' },
  // Amatic вузький і дрібний: при тому самому розмірі рядка його збільшуємо, щоб повзунок лишався співставним
  { id: "amatic", label: "Amatic SC — крейда на дошці", family: '"Amatic SC", "Caveat", cursive', scale: 1.35 },
  { id: "pacifico", label: "Pacifico — неонова вивіска", family: '"Pacifico", "Lobster", cursive' },
] as const;
export type MenuFontId = (typeof MENU_FONTS)[number]["id"];

/**
 * Оформлення цілком: звичайна картка, неонова вивіска (трубки світяться на темній цегляній стіні) або
 * шкільна дошка (рукописна крейда в деревʼяній рамці). Фон, сяйво й фактура — CSS-класи `look-*` на ТБ;
 * тут лише шрифт і кольори за замовчуванням, щоб редактор показував ті самі значення, що й екран.
 */
/** Стіни під неон (CSS-класи `surf-*`); перша — за замовчуванням. */
export const NEON_SURFACES = [
  { id: "brick", label: "Цегла" },
  { id: "concrete", label: "Бетон" },
  { id: "wood", label: "Темне дерево" },
  { id: "black", label: "Чорне тло" },
] as const;
/** Дошки під крейду; перша — за замовчуванням. */
export const CHALK_SURFACES = [
  { id: "green", label: "Зелена дошка" },
  { id: "blackboard", label: "Чорна дошка" },
  { id: "slate", label: "Сіро-синій сланець" },
] as const;

/** Неонові рамки-трубки навколо меню (лише в оформленні «неон»): одна кольором заголовка або дві — ще й кольором тексту. */
export const NEON_FRAMES = [
  { id: "none", label: "без рамки" },
  { id: "single", label: "одна трубка" },
  { id: "double", label: "дві трубки" },
] as const;
export type NeonFrameId = (typeof NEON_FRAMES)[number]["id"];

export const MENU_LOOKS = [
  { id: "standard", label: "Звичайне", font: "system", color: null, accent: null, surfaces: [] },
  { id: "neon", label: "Неонова вивіска", font: "comfortaa", color: "#7df9ff", accent: "#ff4fc8", surfaces: NEON_SURFACES },
  { id: "chalk", label: "Крейдою на дошці", font: "amatic", color: "#f2efe6", accent: "#ffe27a", surfaces: CHALK_SURFACES },
] as const;
export type MenuLookId = (typeof MENU_LOOKS)[number]["id"];

/** Фон оформлення з props.surface; невідомий — перший для цього оформлення, у звичайного — null. */
export function lookSurface(look: MenuLookId, surface: unknown): string | null {
  const list: readonly { id: string }[] = MENU_LOOKS.find((l) => l.id === look)?.surfaces ?? [];
  return (list.find((x) => x.id === surface) ?? list[0])?.id ?? null;
}

export const MENU_FONT_SIZE = { min: 0.8, max: 4, step: 0.1, default: 1.7 };   // vw
const LEGACY_SIZE: Record<string, number> = { small: 1.3, medium: 1.7, large: 2.2 };
const HEX = /^#[0-9a-f]{6}$/i;

export interface MenuStyle {
  look: MenuLookId;
  /** фон неону чи дошки (клас `surf-<id>`); null у звичайного оформлення */
  surface: string | null;
  /** неонова рамка (клас `nfr-<id>`); поза неоном завжди none */
  frame: NeonFrameId;
  fontId: MenuFontId;
  fontFamily: string;
  /** розмір рядка меню у vw (значення повзунка) */
  fontSize: number;
  /** розмір для CSS з поправкою на шрифт, vw */
  cssSize: number;
  /** колір тексту; null = колір теми */
  color: string | null;
  /** колір заголовка й цін; null = як текст */
  accent: string | null;
  /** фон картки rgba; null = стандартний фон теми (у неону й дошки фон свій, тому завжди null) */
  background: string | null;
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Розбирає props віджета (з урахуванням старого size: small|medium|large) у готові CSS-значення. */
export function menuStyle(props: Record<string, unknown>, theme: "dark" | "light" = "dark"): MenuStyle {
  const look = MENU_LOOKS.find((l) => l.id === props.look) ?? MENU_LOOKS[0];
  const fontId = (MENU_FONTS.find((f) => f.id === props.font)?.id ?? look.font) as MenuFontId;
  const raw = Number(props.fontSize);
  const fontSize = Number.isFinite(raw) && raw > 0
    ? Math.max(MENU_FONT_SIZE.min, Math.min(MENU_FONT_SIZE.max, raw))
    : (LEGACY_SIZE[String(props.size ?? "")] ?? MENU_FONT_SIZE.default);
  const color = HEX.test(String(props.color ?? "")) ? String(props.color) : look.color;
  const accent = HEX.test(String(props.accent ?? "")) ? String(props.accent) : look.accent;
  const bgHex = HEX.test(String(props.bg ?? "")) ? String(props.bg) : null;
  const alphaRaw = Number(props.bgAlpha);
  const alpha = Number.isFinite(alphaRaw) && props.bgAlpha !== "" && props.bgAlpha !== null && props.bgAlpha !== undefined ? alphaRaw / 100 : null;
  let background: string | null = null;
  if (look.id === "standard" && (bgHex || alpha !== null)) background = hexToRgba(bgHex ?? (theme === "light" ? "#ffffff" : "#0a101c"), alpha ?? (theme === "light" ? 0.7 : 0.55));
  const font = MENU_FONTS.find((f) => f.id === fontId)!;
  const cssSize = Math.round(fontSize * ("scale" in font ? font.scale : 1) * 100) / 100;
  const frame = look.id === "neon" ? (NEON_FRAMES.find((f) => f.id === props.frame)?.id ?? "none") : "none";
  return { look: look.id, surface: lookSurface(look.id, props.surface), frame, fontId, fontFamily: font.family, fontSize, cssSize, color, accent, background };
}

/**
 * Віджет «Неонова вивіска» (`neon_sign`): назва закладу трубками на стіні, розмір підганяється під віджет,
 * тож на окремій сцені на весь екран вона й займає весь екран.
 */
export const NEON_SIGN_FLICKER = [
  { id: "soft", label: "ледь помітне мерехтіння" },
  { id: "broken", label: "одна літера «барахлить»" },
  { id: "none", label: "рівне світло" },
] as const;

export interface NeonSignStyle {
  lines: string[];
  sub: string;
  fontFamily: string;
  fontId: MenuFontId;
  color: string;
  subColor: string;
  /** клас фону або null — без стіни (поверх відеофону) */
  surface: string | null;
  flicker: (typeof NEON_SIGN_FLICKER)[number]["id"];
  /** рамка-трубка навколо напису */
  frame: boolean;
}

export function neonSignStyle(props: Record<string, unknown>): NeonSignStyle {
  const font = MENU_FONTS.find((f) => f.id === props.font) ?? MENU_FONTS.find((f) => f.id === "pacifico")!;
  // український апостроф ʼ (U+02BC) є не в кожному декоративному шрифті, а ’ (U+2019) є скрізь
  const lines = String(props.text ?? "").replace(/\u02BC/g, "\u2019").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 4);
  return {
    lines: lines.length ? lines : ["Назва закладу"],
    sub: String(props.sub ?? "").trim(),
    fontFamily: font.family,
    fontId: font.id,
    color: HEX.test(String(props.color ?? "")) ? String(props.color) : "#ff4fc8",
    subColor: HEX.test(String(props.subColor ?? "")) ? String(props.subColor) : "#7df9ff",
    surface: props.card === false ? null : lookSurface("neon", props.surface),
    flicker: NEON_SIGN_FLICKER.find((f) => f.id === props.flicker)?.id ?? "soft",
    frame: props.frame === true,
  };
}
