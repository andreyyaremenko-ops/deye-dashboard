/** Заголовки сторінок; лендінг має збігатися з <title> в index.html (пререндер). */
import { PRODUCT_NAME } from "@deye/shared";
export const LANDING_TITLE = "SunHunter TV — сонячна станція, меню й тривоги на телевізорі закладу";
export function titleFor(path: string): string {
  if (path === "/" || path === "/landing") return LANDING_TITLE;
  if (path.startsWith("/login")) return `Вхід — ${PRODUCT_NAME}`;
  if (path.startsWith("/signup")) return `Реєстрація — ${PRODUCT_NAME}`;
  if (path.startsWith("/admin")) return `Адміністрування — ${PRODUCT_NAME}`;
  return `Кабінет — ${PRODUCT_NAME}`;
}
export function isPublicPath(path: string) { return path === "/" || path === "/landing"; }
