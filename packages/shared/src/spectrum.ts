/**
 * Візуалізація звуку радіо: спільний каталог режимів і тем для редактора й екрана.
 * Саме малювання — в apps/tv/src/spectrum.ts (canvas, без залежностей).
 */
export type VizMode = "bars" | "mirror" | "circle" | "orbit";
export type VizThemeId = "ember" | "tide" | "dusk" | "moss" | "ivory";
export type Rgb = readonly [number, number, number];
export interface VizTheme { id: VizThemeId; name: string; bg: string; a: Rgb; b: Rgb }

export const VIZ_MODES: { id: VizMode; label: string }[] = [
  { id: "bars", label: "Стовпці" },
  { id: "mirror", label: "Дзеркало" },
  { id: "circle", label: "Коло" },
  { id: "orbit", label: "Орбіта" },
];

export const VIZ_THEMES: VizTheme[] = [
  { id: "ember", name: "Жар", bg: "#100c09", a: [255, 107, 61], b: [255, 196, 92] },
  { id: "tide", name: "Приплив", bg: "#071116", a: [45, 212, 191], b: [125, 211, 252] },
  { id: "dusk", name: "Сутінки", bg: "#100c14", a: [244, 114, 182], b: [196, 181, 253] },
  { id: "moss", name: "Мох", bg: "#07110c", a: [163, 230, 53], b: [52, 211, 153] },
  { id: "ivory", name: "Срібло", bg: "#0c0c0c", a: [168, 162, 158], b: [255, 250, 245] },
];

/** Ефір стиснений по динаміці, тому вже на 1.2 усі смуги впираються в стелю — за замовчуванням нижче. */
export const VIZ_SENS = { min: 0.4, max: 3, default: 0.8 };

export const vizMode = (v: unknown): VizMode => (VIZ_MODES.some((m) => m.id === v) ? (v as VizMode) : "bars");
export const vizTheme = (v: unknown): VizTheme => VIZ_THEMES.find((t) => t.id === v) ?? VIZ_THEMES[0]!;
export const vizSensitivity = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(VIZ_SENS.max, Math.max(VIZ_SENS.min, n)) : VIZ_SENS.default;
};

export const rgba = (c: Rgb, alpha: number) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, alpha))})`;
export const mix = (a: Rgb, b: Rgb, t: number): Rgb => {
  const k = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};
