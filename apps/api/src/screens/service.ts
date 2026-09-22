import { and, eq, count, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { screenConfigSchema, type ScreenConfig } from "@deye/shared";
import { backgrounds, devices, menus, organizations, plans, screens } from "../db/schema.ts";
import { randomToken } from "../lib/crypto.ts";
import { randomInt } from "node:crypto";
import { badRequest, conflict, isUniqueViolation, notFound } from "../lib/errors.ts";
import { getOrgWithPlan, requireRole } from "../orgs/service.ts";
import { menuPayloads } from "../menus/service.ts";
import { isAllowedRadio } from "../radio/service.ts";

type Db = PgDatabase<any, any, any>;

export const defaultConfig: ScreenConfig = screenConfigSchema.parse({ backgroundId: null, location: null, widgets: [], radioUrl: null, radioVolume: 0.6, tvVideo: "auto", theme: "dark" });

/** Старі рядки в БД без scenes -> єдиний вигляд зі сценами; зіпсований конфіг не валить екран. */
function normalized(config: unknown): ScreenConfig {
  const r = screenConfigSchema.safeParse(config);
  return r.success ? r.data : defaultConfig;
}
const deviceIdsOf = (cfg: ScreenConfig) => [...new Set(cfg.scenes.flatMap((sc) => sc.widgets.map((w) => w.deviceId)).filter((x): x is string => !!x))];
const backgroundIdsOf = (cfg: ScreenConfig) => [...new Set(cfg.scenes.map((sc) => sc.backgroundId).filter((x): x is string => !!x))];
const menuIdsOf = (cfg: ScreenConfig) => [...new Set(cfg.scenes.flatMap((sc) => sc.widgets
  .filter((w) => w.type === "menu")
  .map((w) => (typeof w.props.menuId === "string" ? w.props.menuId : null))).filter((x): x is string => !!x))];

/** Екрани організації, що показують це меню: кому слати новий конфіг після зміни цін чи наявності. */
export async function screensUsingMenu(db: Db, orgId: string, menuId: string): Promise<string[]> {
  const rows = await db.select({ id: screens.id, config: screens.config }).from(screens).where(eq(screens.orgId, orgId));
  return rows.filter((r) => menuIdsOf(normalized(r.config)).includes(menuId)).map((r) => r.id);
}

async function validateConfig(db: Db, orgId: string, input: unknown): Promise<ScreenConfig> {
  const parsed = screenConfigSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Bad screen config: " + parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; "));
  const cfg = parsed.data;
  if (new Set(cfg.scenes.map((sc) => sc.id)).size !== cfg.scenes.length) throw badRequest("Scene ids must be unique");
  // віджети всіх сцен можуть посилатись лише на пристрої цієї організації
  const ids = deviceIdsOf(cfg);
  if (ids.length) {
    const own = await db.select({ id: devices.id }).from(devices).where(and(eq(devices.orgId, orgId), inArray(devices.id, ids)));
    if (own.length !== ids.length) throw badRequest("Widget references a device not in this organization");
  }
  const { plan } = await getOrgWithPlan(db, orgId);
  if (cfg.radioUrl && !plan.limits.radio) throw conflict("Radio is not included in the plan", "plan_limit");
  // радіо — лише з каталогу або власні перевірені станції цієї організації, а не довільна адреса
  if (cfg.radioUrl && !(await isAllowedRadio(db, orgId, cfg.radioUrl))) throw badRequest("Radio station not available", "bad_radio");
  const bgIds = backgroundIdsOf(cfg);
  if (bgIds.length) {
    const rows = await db.select({ id: backgrounds.id, orgId: backgrounds.orgId }).from(backgrounds).where(inArray(backgrounds.id, bgIds));
    const ok = rows.filter((bg) => bg.orgId === null || bg.orgId === orgId);
    if (ok.length !== bgIds.length) throw badRequest("Background not available", "bad_background");
  }
  // віджет меню може посилатись лише на меню цієї організації
  const menuIds = menuIdsOf(cfg);
  if (menuIds.length) {
    const rows = await db.select({ id: menus.id }).from(menus).where(and(eq(menus.orgId, orgId), inArray(menus.id, menuIds)));
    if (rows.length !== menuIds.length) throw badRequest("Menu not available", "bad_menu");
  }
  return cfg;
}

export async function createScreen(db: Db, orgId: string, actorId: string, name: string, config: unknown = defaultConfig) {
  await requireRole(db, orgId, actorId, "admin");
  const { plan } = await getOrgWithPlan(db, orgId);
  const [{ n }] = await db.select({ n: count() }).from(screens).where(eq(screens.orgId, orgId)) as [{ n: number }];
  if (Number(n) >= plan.limits.screens) throw conflict(`Plan allows ${plan.limits.screens} screen(s)`, "plan_limit");
  const cfg = await validateConfig(db, orgId, config);
  const [s] = await db.insert(screens).values({ orgId, name, config: cfg, viewToken: randomToken(32) }).returning();
  return s!;
}

export async function listScreens(db: Db, orgId: string) {
  return db.select().from(screens).where(eq(screens.orgId, orgId));
}

export async function updateScreen(db: Db, orgId: string, actorId: string, id: string, patch: { name?: string; config?: unknown }) {
  await requireRole(db, orgId, actorId, "admin");
  const set: Partial<typeof screens.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.config !== undefined) set.config = await validateConfig(db, orgId, patch.config);
  const [s] = await db.update(screens).set(set).where(and(eq(screens.id, id), eq(screens.orgId, orgId))).returning();
  if (!s) throw notFound("Screen not found");
  return s;
}

export async function rotateToken(db: Db, orgId: string, actorId: string, id: string) {
  await requireRole(db, orgId, actorId, "admin");
  const [s] = await db.update(screens).set({ viewToken: randomToken(32), pairCode: null, pairCodeExpiresAt: null, updatedAt: new Date() })
    .where(and(eq(screens.id, id), eq(screens.orgId, orgId))).returning();
  if (!s) throw notFound("Screen not found");
  return s;
}

export async function deleteScreen(db: Db, orgId: string, actorId: string, id: string) {
  await requireRole(db, orgId, actorId, "admin");
  const res = await db.delete(screens).where(and(eq(screens.id, id), eq(screens.orgId, orgId))).returning({ id: screens.id });
  if (!res.length) throw notFound("Screen not found");
}

/** Публічний екран: конфіг + id пристроїв, до яких він має доступ. Нічого про організацію. */
export async function publicScreen(db: Db, token: string) {
  const [row] = await db.select({ screen: screens, planLimits: plans.limits }).from(screens)
    .innerJoin(organizations, eq(screens.orgId, organizations.id))
    .innerJoin(plans, eq(organizations.planId, plans.id))
    .where(eq(screens.viewToken, token));
  if (!row) throw notFound("Screen not found");
  const cfg = normalized(row.screen.config);
  const referenced = deviceIdsOf(cfg);
  // лише пристрої, що досі належать цій організації
  const own = referenced.length
    ? await db.select({ id: devices.id, batteryKwh: devices.batteryKwh, minSoc: devices.minSoc, pvKwp: devices.pvKwp }).from(devices).where(and(eq(devices.orgId, row.screen.orgId), inArray(devices.id, referenced)))
    : [];
  // фони всіх сцен: стандартні або власні цієї організації, лише готові
  type Bg = { kind: "video" | "image"; files: Record<string, string> | null; preview: string | null; attribution: string | null };
  const bgMap: Record<string, Bg> = {};
  const bgIds = backgroundIdsOf(cfg);
  if (bgIds.length) {
    const rows = await db.select({ id: backgrounds.id, kind: backgrounds.kind, files: backgrounds.files, preview: backgrounds.preview, status: backgrounds.status, attribution: backgrounds.attribution, orgId: backgrounds.orgId })
      .from(backgrounds).where(inArray(backgrounds.id, bgIds));
    for (const bg of rows) if (bg.status === "ready" && (bg.orgId === null || bg.orgId === row.screen.orgId)) bgMap[bg.id] = { kind: bg.kind, files: bg.files, preview: bg.preview, attribution: bg.attribution };
  }
  const background = cfg.backgroundId ? bgMap[cfg.backgroundId] ?? null : null;   // перша сцена: для старих бандлів ТБ
  // меню віджетів: лише опубліковані меню цієї організації
  const menuMap = await menuPayloads(db, row.screen.orgId, menuIdsOf(cfg));
  return {
    id: row.screen.id,
    name: row.screen.name,
    config: cfg,
    background,
    backgrounds: bgMap,
    menus: menuMap,
    deviceIds: own.map((d) => d.id),
    devices: own.map((d) => ({ id: d.id, batteryKwh: d.batteryKwh, minSoc: d.minSoc, pvKwp: d.pvKwp })),
    location: cfg.location ?? null,
    branding: row.planLimits.branding,
  };
}

export const PAIR_CODE_TTL_MS = 15 * 60_000;

/** 6-значний код для введення на ТБ. Діє 15 хв, один активний код на екран. */
export async function issuePairCode(db: Db, orgId: string, actorId: string, id: string) {
  await requireRole(db, orgId, actorId, "admin");
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS);
    try {
      const [s] = await db.update(screens).set({ pairCode: code, pairCodeExpiresAt: expiresAt })
        .where(and(eq(screens.id, id), eq(screens.orgId, orgId))).returning({ id: screens.id });
      if (!s) throw notFound("Screen not found");
      return { code, expiresAt };
    } catch (e) {
      if (isUniqueViolation(e, "screens_pair_code_idx")) continue; // колізія з чужим активним кодом
      throw e;
    }
  }
  throw conflict("Could not issue a code, try again", "retry");
}

/** ТБ вводить код -> отримує view-токен. Код лишається дійсним до закінчення TTL (кілька ТБ). */
export async function resolvePairCode(db: Db, code: string) {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) throw notFound("Bad code");
  const [s] = await db.select({ viewToken: screens.viewToken, expiresAt: screens.pairCodeExpiresAt, name: screens.name })
    .from(screens).where(eq(screens.pairCode, clean));
  if (!s || !s.expiresAt || s.expiresAt.getTime() < Date.now()) throw notFound("Code not found or expired");
  return { token: s.viewToken, name: s.name };
}
