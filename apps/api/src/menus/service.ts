/**
 * Меню закладу: розділи, позиції, стиль фото. Читання — staff, зміни — admin,
 * наявність (in_stock) — staff (офіціант позначає «закінчилось»).
 * Ціна — ціле число копійок; розбір рядків цін у @deye/shared/menu-data.
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, max, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { DEFAULT_MENU_STYLE, imageModel, planLimitsOf, type MenuItemInput, type MenuPayload } from "@deye/shared";
import { unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { aiJobs, aiUsage, dishImages, menuItems, menuSections, menuStyles, menus } from "../db/schema.ts";
import { HttpError, badRequest, conflict, notFound } from "../lib/errors.ts";
import { getOrgWithPlan, requireRole } from "../orgs/service.ts";

type Db = PgDatabase<any, any, any>;

/** Стиль за замовчуванням, поки заклад не зберіг свій (спільний з воркером). */
export const DEFAULT_STYLE = { id: null as string | null, ...DEFAULT_MENU_STYLE };

export async function getStyle(db: Db, orgId: string) {
  const [s] = await db.select().from(menuStyles).where(and(eq(menuStyles.orgId, orgId), eq(menuStyles.isDefault, true))).limit(1);
  return s ?? { ...DEFAULT_STYLE, orgId, isDefault: true };
}

export interface StylePatch {
  name?: string; prompt: string; bgMode?: string; bgColor?: string | null;
  imageProvider?: string; imageModel?: string; imageQuality?: string;
}

/** Модель має бути з каталогу, а її провайдер — налаштований на сервері (є ключ). */
export function assertImageModel(provider: string, model: string, available: readonly string[]) {
  if (!imageModel(provider, model)) throw badRequest(`Unknown image model ${provider}/${model}`, "bad_model");
  if (!available.includes(provider)) throw conflict(`Провайдер ${provider} не налаштований на сервері`, "provider_unavailable");
}

export async function saveStyle(db: Db, orgId: string, actorId: string, patch: StylePatch, available: readonly string[]) {
  await requireRole(db, orgId, actorId, "admin");
  const current = await getStyle(db, orgId);
  const provider = patch.imageProvider ?? current.imageProvider;
  const model = patch.imageModel ?? current.imageModel;
  if (provider !== current.imageProvider || model !== current.imageModel) assertImageModel(provider, model, available);
  const values = {
    name: patch.name ?? DEFAULT_STYLE.name, prompt: patch.prompt,
    bgMode: patch.bgMode ?? DEFAULT_STYLE.bgMode, bgColor: patch.bgColor ?? DEFAULT_STYLE.bgColor,
    imageProvider: provider, imageModel: model, imageQuality: patch.imageQuality ?? current.imageQuality,
    updatedAt: new Date(),
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

export async function deleteMenu(db: Db, orgId: string, actorId: string, menuId: string, mediaRoot: string) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  await purgeMenuFiles(db, orgId, menuId, mediaRoot);
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

// --- розпізнавання фото меню ---

export const MAX_IMPORT_FILES = 5;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;     // ліміт vision-API на одне фото
export const IMPORT_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

/**
 * Створює чернетку меню (status importing) і ставить задачу воркеру.
 * Фото вже збережені у /media викликаючою стороною: сервіс не працює з потоками.
 */
export async function startImport(db: Db, orgId: string, actorId: string, name: string, files: string[]) {
  if (!files.length) throw badRequest("No files", "no_file");
  const menu = await createMenu(db, orgId, actorId, name, "importing");
  const [job] = await db.insert(aiJobs).values({ orgId, kind: "menu_import", refId: menu.id, payload: { files } }).returning();
  return { menuId: menu.id, jobId: job!.id, status: menu.status };
}

/** Стан останнього розпізнавання цього меню — для екрана перевірки. */
export async function importStatus(db: Db, orgId: string, menuId: string) {
  const menu = await ownMenu(db, orgId, menuId);
  const [job] = await db.select({
    id: aiJobs.id, status: aiJobs.status, error: aiJobs.error, attempts: aiJobs.attempts,
    createdAt: aiJobs.createdAt, finishedAt: aiJobs.finishedAt,
  }).from(aiJobs).where(and(eq(aiJobs.orgId, orgId), eq(aiJobs.kind, "menu_import"), eq(aiJobs.refId, menuId)))
    .orderBy(desc(aiJobs.createdAt)).limit(1);
  return { menu: { id: menu.id, name: menu.name, status: menu.status }, job: job ?? null };
}

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

// --- фото страв ---

export const MAX_DISH_BYTES = 15 * 1024 * 1024;
export const DISH_MIME: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const VARIANTS = { min: 1, max: 4, default: 3 };

const monthStart = sql`date_trunc('month', now())`;

/** Витрати AI за поточний місяць і залишок за тарифом — і для перевірок, і для кабінету. */
export async function aiUsageSummary(db: Db, orgId: string) {
  const { plan } = await getOrgWithPlan(db, orgId);
  const limits = planLimitsOf(plan.limits);
  const [u] = await db.select({
    images: sql<number>`coalesce(sum(${aiUsage.images}), 0)`,
    costMicros: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)`,
    calls: count(),
  }).from(aiUsage).where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, monthStart)));
  const [d] = await db.select({ n: count() }).from(menuItems)
    .innerJoin(menus, eq(menus.id, menuItems.menuId))
    .where(and(eq(menus.orgId, orgId), eq(menuItems.imageIsAi, true)));
  const imagesMonth = Number(u?.images ?? 0);
  const dishesWithAi = Number(d?.n ?? 0);
  return {
    imagesMonth, dishesWithAi,
    calls: Number(u?.calls ?? 0),
    costMicros: Number(u?.costMicros ?? 0),
    limits: { aiDishes: limits.ai_dishes, aiGenerationsMonth: limits.ai_generations_month },
    remaining: {
      images: Math.max(0, limits.ai_generations_month - imagesMonth),
      dishes: Math.max(0, limits.ai_dishes - dishesWithAi),
    },
  };
}

/** Остання задача на фото цієї страви — щоб кабінет показав «генерується». */
async function activeImageJob(db: Db, itemId: string) {
  const [j] = await db.select({ id: aiJobs.id, status: aiJobs.status, error: aiJobs.error, kind: aiJobs.kind, createdAt: aiJobs.createdAt })
    .from(aiJobs).where(and(eq(aiJobs.refId, itemId), inArray(aiJobs.kind, ["dish_image", "dish_upload"])))
    .orderBy(desc(aiJobs.createdAt)).limit(1);
  return j ?? null;
}

/** Варіанти фото страви + стан останньої задачі. */
export async function listDishImages(db: Db, orgId: string, menuId: string, itemId: string) {
  const item = await ownItem(db, orgId, menuId, itemId);
  const images = await db.select().from(dishImages).where(eq(dishImages.itemId, itemId)).orderBy(asc(dishImages.createdAt));
  return { itemId, chosen: item.imageId, imageIsAi: item.imageIsAi, images, job: await activeImageJob(db, itemId) };
}

/** Ставить задачу на N варіантів. Перевіряє обидва ліміти тарифу до постановки. */
export async function requestDishImages(db: Db, orgId: string, actorId: string, menuId: string, itemId: string, n = VARIANTS.default, available: readonly string[] = []) {
  await requireRole(db, orgId, actorId, "admin");
  const item = await ownItem(db, orgId, menuId, itemId);
  const count = Math.min(VARIANTS.max, Math.max(VARIANTS.min, n));
  const s = await aiUsageSummary(db, orgId);
  if (s.limits.aiGenerationsMonth <= 0) throw conflict("AI images are not included in the plan", "plan_limit");
  if (s.imagesMonth + count > s.limits.aiGenerationsMonth) {
    throw conflict(`Plan allows ${s.limits.aiGenerationsMonth} AI image(s) per month`, "plan_limit");
  }
  // нова страва з AI-фото рахується проти ліміту страв; перегенерація вже врахованої — ні
  if (!item.imageIsAi && s.dishesWithAi >= s.limits.aiDishes) {
    throw conflict(`Plan allows AI photos for ${s.limits.aiDishes} dish(es)`, "plan_limit");
  }
  const running = await activeImageJob(db, itemId);
  if (running && (running.status === "queued" || running.status === "running")) throw conflict("Generation already in progress", "in_progress");
  // модель фіксуємо в задачі: зміна стилю поки задача в черзі на неї вже не впливає
  const style = await getStyle(db, orgId);
  assertImageModel(style.imageProvider, style.imageModel, available);
  const alpha = style.bgMode === "transparent" && !!imageModel(style.imageProvider, style.imageModel)?.transparent;
  const payload = { n: count, provider: style.imageProvider, model: style.imageModel, quality: style.imageQuality, alpha };
  const [job] = await db.insert(aiJobs).values({ orgId, kind: "dish_image", refId: itemId, payload }).returning();
  return { jobId: job!.id, itemId, variants: count, status: job!.status };
}

/** Після імпорту: згенерувати фото всім стравам без фото, скільки дозволяє тариф. */
export async function requestMenuImages(db: Db, orgId: string, actorId: string, menuId: string, n = VARIANTS.default, available: readonly string[] = []) {
  await requireRole(db, orgId, actorId, "admin");
  await ownMenu(db, orgId, menuId);
  const items = await db.select({ id: menuItems.id }).from(menuItems)
    .where(and(eq(menuItems.menuId, menuId), isNull(menuItems.imageId))).orderBy(asc(menuItems.sort));
  const queued: string[] = [];
  let stopped: string | null = null;
  for (const it of items) {
    try { queued.push((await requestDishImages(db, orgId, actorId, menuId, it.id, n, available)).jobId); }
    catch (e) {
      if (e instanceof HttpError && e.code === "plan_limit") { stopped = e.message; break; }   // ліміт вичерпано — решту лишаємо власнику
      if (e instanceof HttpError && e.code === "in_progress") continue;
      throw e;
    }
  }
  return { queued: queued.length, items: items.length, stopped };
}

/** Вибір варіанта: image_is_ai береться з самого файлу, а не з запиту. */
export async function chooseDishImage(db: Db, orgId: string, actorId: string, menuId: string, itemId: string, imageId: string) {
  await requireRole(db, orgId, actorId, "admin");
  await ownItem(db, orgId, menuId, itemId);
  const [img] = await db.select().from(dishImages).where(and(eq(dishImages.id, imageId), eq(dishImages.itemId, itemId)));
  if (!img) throw notFound("Image not found");
  if (img.status !== "ready") throw conflict("Image is not ready", "not_ready");
  const [i] = await db.update(menuItems).set({ imageId: img.id, imageIsAi: img.isAi, updatedAt: new Date() })
    .where(eq(menuItems.id, itemId)).returning();
  await touch(db, menuId);
  return i!;
}

export async function deleteDishImage(db: Db, orgId: string, actorId: string, menuId: string, itemId: string, imageId: string, mediaRoot: string) {
  await requireRole(db, orgId, actorId, "admin");
  const item = await ownItem(db, orgId, menuId, itemId);
  const [img] = await db.select().from(dishImages).where(and(eq(dishImages.id, imageId), eq(dishImages.itemId, itemId)));
  if (!img) throw notFound("Image not found");
  await db.delete(dishImages).where(eq(dishImages.id, imageId));
  if (item.imageId === imageId) {
    await db.update(menuItems).set({ imageId: null, imageIsAi: false, updatedAt: new Date() }).where(eq(menuItems.id, itemId));
  }
  await removeFiles(mediaRoot, [img.file, img.thumb]);
  await touch(db, menuId);
}

/** Власне фото: файл уже збережено, воркер зведе його до того самого квадрата. */
export async function startDishUpload(db: Db, orgId: string, actorId: string, menuId: string, itemId: string, file: string) {
  await requireRole(db, orgId, actorId, "admin");
  await ownItem(db, orgId, menuId, itemId);
  const [job] = await db.insert(aiJobs).values({ orgId, kind: "dish_upload", refId: itemId, payload: { file } }).returning();
  return { jobId: job!.id, itemId, status: job!.status };
}

async function removeFiles(mediaRoot: string, files: (string | null)[]) {
  for (const f of files) if (f) await unlink(join(mediaRoot, f)).catch(() => {});
}

/** Файли меню: фото страв і фото-оригінали імпорту. Викликається перед видаленням меню. */
export async function purgeMenuFiles(db: Db, orgId: string, menuId: string, mediaRoot: string) {
  const imgs = await db.select({ file: dishImages.file, thumb: dishImages.thumb }).from(dishImages)
    .innerJoin(menuItems, eq(menuItems.id, dishImages.itemId))
    .where(eq(menuItems.menuId, menuId));
  await removeFiles(mediaRoot, imgs.flatMap((i) => [i.file, i.thumb]));
  const jobs = await db.select({ payload: aiJobs.payload }).from(aiJobs)
    .where(and(eq(aiJobs.orgId, orgId), eq(aiJobs.kind, "menu_import"), eq(aiJobs.refId, menuId)));
  for (const j of jobs) {
    const files = (j.payload?.files as string[] | undefined) ?? [];
    const dir = files[0]?.split("/").slice(0, 2).join("/");
    if (dir?.startsWith("menu-import/")) await rm(join(mediaRoot, dir), { recursive: true, force: true }).catch(() => {});
  }
}
