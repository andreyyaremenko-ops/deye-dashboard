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
export const MENU_LOOKS = [
  { id: "standard", label: "Звичайне", font: "system", color: null, accent: null },
  { id: "neon", label: "Неонова вивіска", font: "comfortaa", color: "#7df9ff", accent: "#ff4fc8" },
  { id: "chalk", label: "Крейдою на дошці", font: "amatic", color: "#f2efe6", accent: "#ffe27a" },
] as const;
export type MenuLookId = (typeof MENU_LOOKS)[number]["id"];

export const MENU_FONT_SIZE = { min: 0.8, max: 4, step: 0.1, default: 1.7 };   // vw
const LEGACY_SIZE: Record<string, number> = { small: 1.3, medium: 1.7, large: 2.2 };
const HEX = /^#[0-9a-f]{6}$/i;

export interface MenuStyle {
  look: MenuLookId;
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
  return { look: look.id, fontId, fontFamily: font.family, fontSize, cssSize, color, accent, background };
}
