import { and, eq, count, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { screenConfigSchema, type ScreenConfig } from "@deye/shared";
import { backgrounds, devices, organizations, plans, screens } from "../db/schema.ts";
import { randomToken } from "../lib/crypto.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { getOrgWithPlan, requireRole } from "../orgs/service.ts";

type Db = PgDatabase<any, any, any>;

export const defaultConfig: ScreenConfig = { backgroundId: null, widgets: [], radioUrl: null, radioVolume: 0.6, theme: "dark" };

async function validateConfig(db: Db, orgId: string, input: unknown): Promise<ScreenConfig> {
  const parsed = screenConfigSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Bad screen config: " + parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; "));
  const cfg = parsed.data;
  // віджети можуть посилатись лише на пристрої цієї організації
  const ids = [...new Set(cfg.widgets.map((w) => w.deviceId).filter((x): x is string => !!x))];
  if (ids.length) {
    const own = await db.select({ id: devices.id }).from(devices).where(and(eq(devices.orgId, orgId), inArray(devices.id, ids)));
    if (own.length !== ids.length) throw badRequest("Widget references a device not in this organization");
  }
  const { plan } = await getOrgWithPlan(db, orgId);
  if (cfg.radioUrl && !plan.limits.radio) throw conflict("Radio is not included in the plan", "plan_limit");
  if (cfg.backgroundId) {
    const [bg] = await db.select({ orgId: backgrounds.orgId }).from(backgrounds).where(eq(backgrounds.id, cfg.backgroundId));
    if (!bg || (bg.orgId !== null && bg.orgId !== orgId)) throw badRequest("Background not available", "bad_background");
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
  const [s] = await db.update(screens).set({ viewToken: randomToken(32), updatedAt: new Date() })
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
  const cfg = row.screen.config;
  const referenced = [...new Set(cfg.widgets.map((w) => w.deviceId).filter((x): x is string => !!x))];
  // лише пристрої, що досі належать цій організації
  const own = referenced.length
    ? await db.select({ id: devices.id }).from(devices).where(and(eq(devices.orgId, row.screen.orgId), inArray(devices.id, referenced)))
    : [];
  let background: { files: Record<string, string> | null; preview: string | null; attribution: string | null } | null = null;
  if (cfg.backgroundId) {
    const [bg] = await db.select({ files: backgrounds.files, preview: backgrounds.preview, status: backgrounds.status, attribution: backgrounds.attribution, orgId: backgrounds.orgId })
      .from(backgrounds).where(eq(backgrounds.id, cfg.backgroundId));
    // стандартний або власний цієї організації
    if (bg && bg.status === "ready" && (bg.orgId === null || bg.orgId === row.screen.orgId)) background = { files: bg.files, preview: bg.preview, attribution: bg.attribution };
  }
  return {
    id: row.screen.id,
    name: row.screen.name,
    config: cfg,
    background,
    deviceIds: own.map((d) => d.id),
    branding: row.planLimits.branding,
  };
}
