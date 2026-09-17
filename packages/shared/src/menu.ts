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
] as const;
export type MenuFontId = (typeof MENU_FONTS)[number]["id"];

export const MENU_FONT_SIZE = { min: 0.8, max: 4, step: 0.1, default: 1.7 };   // vw
const LEGACY_SIZE: Record<string, number> = { small: 1.3, medium: 1.7, large: 2.2 };
const HEX = /^#[0-9a-f]{6}$/i;

export interface MenuStyle {
  fontId: MenuFontId;
  fontFamily: string;
  /** розмір рядка меню у vw */
  fontSize: number;
  /** колір тексту; null = колір теми */
  color: string | null;
  /** колір заголовка й цін; null = як текст */
  accent: string | null;
  /** фон картки rgba; null = стандартний фон теми */
  background: string | null;
}

export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha))})`;
}

/** Розбирає props віджета (з урахуванням старого size: small|medium|large) у готові CSS-значення. */
export function menuStyle(props: Record<string, unknown>, theme: "dark" | "light" = "dark"): MenuStyle {
  const fontId = (MENU_FONTS.find((f) => f.id === props.font)?.id ?? "system") as MenuFontId;
  const raw = Number(props.fontSize);
  const fontSize = Number.isFinite(raw) && raw > 0
    ? Math.max(MENU_FONT_SIZE.min, Math.min(MENU_FONT_SIZE.max, raw))
    : (LEGACY_SIZE[String(props.size ?? "")] ?? MENU_FONT_SIZE.default);
  const color = HEX.test(String(props.color ?? "")) ? String(props.color) : null;
  const accent = HEX.test(String(props.accent ?? "")) ? String(props.accent) : null;
  const bgHex = HEX.test(String(props.bg ?? "")) ? String(props.bg) : null;
  const alphaRaw = Number(props.bgAlpha);
  const alpha = Number.isFinite(alphaRaw) && props.bgAlpha !== "" && props.bgAlpha !== null && props.bgAlpha !== undefined ? alphaRaw / 100 : null;
  let background: string | null = null;
  if (bgHex || alpha !== null) background = hexToRgba(bgHex ?? (theme === "light" ? "#ffffff" : "#0a101c"), alpha ?? (theme === "light" ? 0.7 : 0.55));
  return { fontId, fontFamily: MENU_FONTS.find((f) => f.id === fontId)!.family, fontSize, color, accent, background };
}
