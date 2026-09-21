/**
 * Меню закладу: розділи, позиції, стиль фото. Читання — staff, зміни — admin,
 * наявність (in_stock) — staff (офіціант позначає «закінчилось»).
 * Ціна — ціле число копійок; розбір рядків цін у @deye/shared/menu-data.
 */
import { and, asc, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { planLimitsOf, type MenuItemInput, type MenuPayload } from "@deye/shared";
import { dishImages, menuItems, menuSections, menuStyles, menus } from "../db/schema.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { getOrgWithPlan, requireRole } from "../orgs/service.ts";

type Db = PgDatabase<any, any, any>;

/** Стиль за замовчуванням, поки заклад не зберіг свій. */
export const DEFAULT_STYLE = {
  id: null as string | null,
  name: "Стандартний",
  prompt: "Апетитна фотографія страви для меню кафе, вигляд згори під кутом 45°, "
    + "мʼяке природне світло, неглибока різкість, акуратна подача на простому посуді",
  bgMode: "solid",
  bgColor: "#f2ece3",
};

export async function getStyle(db: Db, orgId: string) {
  const [s] = await db.select().from(menuStyles).where(and(eq(menuStyles.orgId, orgId), eq(menuStyles.isDefault, true))).limit(1);
  return s ?? { ...DEFAULT_STYLE, orgId, isDefault: true };
}

export async function saveStyle(db: Db, orgId: string, actorId: string, patch: { name?: string; prompt: string; bgMode?: string; bgColor?: string | null }) {
  await requireRole(db, orgId, actorId, "admin");
  const values = {
    name: patch.name ?? DEFAULT_STYLE.name, prompt: patch.prompt,
    bgMode: patch.bgMode ?? DEFAULT_STYLE.bgMode, bgColor: patch.bgColor ?? DEFAULT_STYLE.bgColor, updatedAt: new Date(),
  };
  const [existing] = await db.select({ id: menuStyles.id }).from(menuStyles)
    .where(and(eq(menuStyles.orgId, orgId), eq(menuStyles.isDefault, true))).limit(1);
  if (existing) {
    const [s] = await db.update(menuStyles).set(values).where(eq(menuStyles.id, existing.id)).returning();
    return s!;
  }
  const [s] = await db.insert(menuStyles).values({ orgId, isDefault: true, ...values }).returning();
  return s!;
}

export async function listMenus(db: Db, orgId: string) {
  const rows = await db.select({
    id: menus.id, name: menus.name, status: menus.status, styleId: menus.styleId,
    publishedAt: menus.publishedAt, createdAt: menus.createdAt, updatedAt: menus.updatedAt,
    items: sql<number>`(select count(*) from ${menuItems} where ${menuItems.menuId} = ${menus.id})`,
  }).from(menus).where(eq(menus.orgId, orgId)).orderBy(desc(menus.createdAt));
  return rows.map((r) => ({ ...r, items: Number(r.items) }));
}

/** Рядок меню цієї організації або 404. */
export async function ownMenu(db: Db, orgId: string, menuId: string) {
  const [m] = await db.select().from(menus).where(and(eq(menus.id, menuId), eq(menus.orgId, orgId)));
  if (!m) throw notFound("Menu not found");
  return m;
}

/** Повне дерево для кабінету: розділи, позиції, варіанти фото. */
export async function getMenu(db: Db, orgId: string, menuId: string) {
  const menu = await ownMenu(db, orgId, menuId);
  const sections = await db.select().from(menuSections).where(eq(menuSections.menuId, menuId)).orderBy(asc(menuSections.sort), asc(menuSections.name));
  const items = await db.select().from(menuItems).where(eq(menuItems.menuId, menuId)).orderBy(asc(menuItems.sort), asc(menuItems.name));
  const ids = items.map((i) => i.id);
  const imgs = ids.length ? await db.select().from(dishImages).where(inArray(dishImages.itemId, ids)).orderBy(asc(dishImages.createdAt)) : [];
  const byItem = new Map<string, typeof imgs>();
  for (const img of imgs) {
    const list = byItem.get(img.itemId!) ?? [];
    list.push(img); byItem.set(img.itemId!, list);
  }
  return {
    ...menu,
    sections: sections.map((s) => ({
      ...s,
      items: items.filter((i) => i.sectionId === s.id).map((i) => ({ ...i, images: byItem.get(i.id) ?? [] })),
    })),
  };
}

export async function createMenu(db: Db, orgId: string, actorId: string, name: string, status: "draft" | "importing" = "draft") {
  await requireRole(db, orgId, actorId, "admin");
  const { plan } = await getOrgWithPlan(db, orgId);
  const limits = planLimitsOf(plan.limits);
  const [{ n }] = await db.select({ n: count() }).from(menus).where(eq(menus.orgId, orgId)) as [{ n: number }];
  if (Number(n) >= limits.menus) throw conflict(`Plan allows ${limits.menus} menu(s)`, "plan_limit");
  const [m] = await db.insert(menus).values({ orgId, name, status }).returning();
  return m!;
}

export async function updateMenu(db: Db, orgId: string, actorId: string, menuId: string, patch: { name?: string; styleId?: string | null }) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  if (patch.styleId) {
    const [s] = await db.select({ id: menuStyles.id }).from(menuStyles).where(and(eq(menuStyles.id, patch.styleId), eq(menuStyles.orgId, orgId)));
    if (!s) throw badRequest("Style not available", "bad_style");
  }
  const [m] = await db.update(menus).set({ ...patch, updatedAt: new Date() }).where(eq(menus.id, menuId)).returning();
  return m!;
}

export async function deleteMenu(db: Db, orgId: string, actorId: string, menuId: string) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  await db.delete(menus).where(eq(menus.id, menuId));
}

/** Чернетка -> робоче меню. Публікувати порожнє немає сенсу. */
export async function publishMenu(db: Db, orgId: string, actorId: string, menuId: string) {
  await requireRole(db, orgId, actorId, "admin");
  const menu = await ownMenu(db, orgId, menuId);
  if (menu.status === "importing") throw conflict("Menu is still being recognised", "importing");
  const [{ n }] = await db.select({ n: count() }).from(menuItems).where(eq(menuItems.menuId, menuId)) as [{ n: number }];
  if (Number(n) === 0) throw badRequest("Menu has no items", "empty_menu");
  const [m] = await db.update(menus).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(eq(menus.id, menuId)).returning();
  return m!;
}

const touch = (db: Db, menuId: string) => db.update(menus).set({ updatedAt: new Date() }).where(eq(menus.id, menuId));

// --- розділи ---

async function nextSort(db: Db, table: any, column: any, value: string): Promise<number> {
  const [row] = await db.select({ m: max(table.sort) }).from(table).where(eq(column, value));
  return (row?.m ?? -1) + 1;
}

export async function addSection(db: Db, orgId: string, actorId: string, menuId: string, input: { name: string; sort?: number }) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  const sort = input.sort ?? await nextSort(db, menuSections, menuSections.menuId, menuId);
  const [s] = await db.insert(menuSections).values({ menuId, name: input.name, sort }).returning();
  await touch(db, menuId);
  return s!;
}

export async function updateSection(db: Db, orgId: string, actorId: string, menuId: string, sectionId: string, patch: { name?: string; sort?: number }) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  const [s] = await db.update(menuSections).set(patch).where(and(eq(menuSections.id, sectionId), eq(menuSections.menuId, menuId))).returning();
  if (!s) throw notFound("Section not found");
  await touch(db, menuId);
  return s;
}

export async function deleteSection(db: Db, orgId: string, actorId: string, menuId: string, sectionId: string) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  const res = await db.delete(menuSections).where(and(eq(menuSections.id, sectionId), eq(menuSections.menuId, menuId))).returning({ id: menuSections.id });
  if (!res.length) throw notFound("Section not found");
  await touch(db, menuId);
}

// --- позиції ---

async function ownSection(db: Db, menuId: string, sectionId: string) {
  const [s] = await db.select({ id: menuSections.id }).from(menuSections).where(and(eq(menuSections.id, sectionId), eq(menuSections.menuId, menuId)));
  if (!s) throw badRequest("Section not in this menu", "bad_section");
  return s;
}

export async function addItem(db: Db, orgId: string, actorId: string, menuId: string, input: MenuItemInput) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  await ownSection(db, menuId, input.sectionId);
  const sort = input.sort ?? await nextSort(db, menuItems, menuItems.sectionId, input.sectionId);
  const [i] = await db.insert(menuItems).values({
    menuId, sectionId: input.sectionId, name: input.name, description: input.description ?? null,
    price: input.price ?? null, volume: input.volume ?? null, sort, inStock: input.inStock ?? true,
  }).returning();
  await touch(db, menuId);
  return i!;
}

/** Правка позиції; зміна sectionId — перенесення між розділами. Ручне правлення скидає confidence. */
export async function updateItem(db: Db, orgId: string, actorId: string, menuId: string, itemId: string, patch: Partial<MenuItemInput>) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  if (patch.sectionId) await ownSection(db, menuId, patch.sectionId);
  const set: Record<string, unknown> = { ...patch, confidence: null, updatedAt: new Date() };
  const [i] = await db.update(menuItems).set(set).where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, menuId))).returning();
  if (!i) throw notFound("Item not found");
  await touch(db, menuId);
  return i;
}

/** Наявність позиції: дозволено staff — це щоденна робота залу, а не редагування меню. */
export async function setStock(db: Db, orgId: string, actorId: string, menuId: string, itemId: string, inStock: boolean) {
  await requireRole(db, orgId, actorId, "staff");
  await ownMenu(db, orgId, menuId);
  const [i] = await db.update(menuItems).set({ inStock, updatedAt: new Date() })
    .where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, menuId))).returning();
  if (!i) throw notFound("Item not found");
  await touch(db, menuId);
  return i;
}

export async function deleteItem(db: Db, orgId: string, actorId: string, menuId: string, itemId: string) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  const res = await db.delete(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, menuId))).returning({ id: menuItems.id });
  if (!res.length) throw notFound("Item not found");
  await touch(db, menuId);
}

/** Позиція цієї організації (для операцій із фото). */
export async function ownItem(db: Db, orgId: string, menuId: string, itemId: string) {
  await ownMenu(db, orgId, menuId);
  const [i] = await db.select().from(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.menuId, menuId)));
  if (!i) throw notFound("Item not found");
  return i;
}

/** Опубліковані меню для ТБ: лише потрібні поля, приховані позиції лишаються (ТБ вирішує, як показати). */
export async function menuPayloads(db: Db, orgId: string, ids: string[]): Promise<Record<string, MenuPayload>> {
  if (!ids.length) return {};
  const rows = await db.select({ id: menus.id, name: menus.name, updatedAt: menus.updatedAt }).from(menus)
    .where(and(eq(menus.orgId, orgId), eq(menus.status, "published"), inArray(menus.id, ids)));
  if (!rows.length) return {};
  const menuIds = rows.map((r) => r.id);
  const sections = await db.select().from(menuSections).where(inArray(menuSections.menuId, menuIds)).orderBy(asc(menuSections.sort), asc(menuSections.name));
  const items = await db.select({
    id: menuItems.id, menuId: menuItems.menuId, sectionId: menuItems.sectionId, name: menuItems.name,
    description: menuItems.description, price: menuItems.price, volume: menuItems.volume,
    inStock: menuItems.inStock, imageIsAi: menuItems.imageIsAi, file: dishImages.file,
  }).from(menuItems).leftJoin(dishImages, eq(dishImages.id, menuItems.imageId))
    .where(inArray(menuItems.menuId, menuIds)).orderBy(asc(menuItems.sort), asc(menuItems.name));
  const out: Record<string, MenuPayload> = {};
  for (const m of rows) {
    out[m.id] = {
      id: m.id, name: m.name, updatedAt: m.updatedAt.toISOString(),
      sections: sections.filter((s) => s.menuId === m.id).map((s) => ({
        id: s.id, name: s.name,
        items: items.filter((i) => i.sectionId === s.id).map((i) => ({
          id: i.id, name: i.name, description: i.description, price: i.price, volume: i.volume,
          inStock: i.inStock, image: i.file ?? null, imageIsAi: i.imageIsAi,
        })),
      })),
    };
  }
  return out;
}
