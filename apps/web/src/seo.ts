/** Заголовки сторінок і публічні шляхи. Title лендінгу береться з landing/content.ts — того ж джерела, що й пререндерений <head>. */
import { PRODUCT_NAME } from "@deye/shared";
import { CONTENT, langOfPath } from "./landing/content.ts";

/** Лендінг: "/" українською, "/en" англійською; "/landing" — стара адреса української версії. */
export function isPublicPath(path: string) { return path === "/" || path === "/landing" || path === "/en" || path === "/en/"; }
export function titleFor(path: string): string {
  if (isPublicPath(path)) return CONTENT[langOfPath(path)].meta.title;
  if (path.startsWith("/login")) return `Вхід — ${PRODUCT_NAME}`;
  if (path.startsWith("/signup")) return `Реєстрація — ${PRODUCT_NAME}`;
  if (path.startsWith("/admin")) return `Адміністрування — ${PRODUCT_NAME}`;
  return `Кабінет — ${PRODUCT_NAME}`;
}
