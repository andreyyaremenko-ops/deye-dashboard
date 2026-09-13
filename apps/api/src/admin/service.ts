/** Панель суперадміна: усі організації, пристрої, платежі; ручна зміна тарифу. */
import { desc, eq, sql, count, and } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { devices, memberships, organizations, payments, plans, screens, user } from "../db/schema.ts";
import { badRequest, notFound } from "../lib/errors.ts";

type Db = PgDatabase<any, any, any>;

export async function overview(db: Db) {
  const orgs = await db.select({
    id: organizations.id, name: organizations.name, planId: organizations.planId, planUntil: organizations.planUntil, createdAt: organizations.createdAt,
    devices: sql<number>`(select count(*) from devices d where d.org_id = organizations.id)`,
    online: sql<number>`(select count(*) from devices d where d.org_id = organizations.id and d.online)`,
    screens: sql<number>`(select count(*) from screens s where s.org_id = organizations.id)`,
    lastSeen: sql<Date | null>`(select max(last_seen_at) from devices d where d.org_id = organizations.id)`,
    owners: sql<string>`(select string_agg(u.email, ', ') from memberships m join "user" u on u.id = m.user_id where m.org_id = organizations.id and m.role = 'owner')`,
    paid: sql<number>`(select coalesce(sum(amount), 0) from payments p where p.org_id = organizations.id and p.status = 'success')`,
  }).from(organizations).orderBy(desc(organizations.createdAt));
  const [totals] = await db.select({
    orgs: count(organizations.id),
  }).from(organizations);
  const [dev] = await db.select({ total: count(devices.id), online: sql<number>`count(*) filter (where ${devices.online})`, unclaimed: sql<number>`count(*) filter (where ${devices.orgId} is null)` }).from(devices);
  const [pay] = await db.select({ success: sql<number>`coalesce(sum(amount) filter (where status = 'success'), 0)`, month: sql<number>`coalesce(sum(amount) filter (where status = 'success' and applied_at > now() - interval '30 days'), 0)` }).from(payments);
  const [usersN] = await db.select({ n: count(user.id) }).from(user);
  return { orgs: orgs.map((o) => ({ ...o, devices: Number(o.devices), online: Number(o.online), screens: Number(o.screens), paid: Number(o.paid) })),
    totals: { orgs: Number(totals?.orgs ?? 0), users: Number(usersN?.n ?? 0), devices: Number(dev?.total ?? 0), online: Number(dev?.online ?? 0), unclaimed: Number(dev?.unclaimed ?? 0), paidTotal: Number(pay?.success ?? 0), paid30d: Number(pay?.month ?? 0) } };
}

export async function allScreens(db: Db) {
  return db.select({
    id: screens.id, name: screens.name, orgId: screens.orgId, orgName: organizations.name, planId: organizations.planId,
    updatedAt: screens.updatedAt, lastViewedAt: screens.lastViewedAt, config: screens.config,
  }).from(screens).innerJoin(organizations, eq(screens.orgId, organizations.id)).orderBy(desc(screens.lastViewedAt))
    .then((rows) => rows.map(({ config, ...r }) => ({ ...r, widgets: config.widgets.length, radio: !!config.radioUrl, background: !!config.backgroundId })));
}

/** Коротка назва пристрою з User-Agent браузера ТБ. */
export function describeUa(ua: string): string {
  if (/Tizen/i.test(ua)) return "Samsung (Tizen)";
  if (/Web0S|webOS/i.test(ua)) return "LG (webOS)";
  if (/Android.*TV|AFT|BRAVIA|SHIELD|MiBOX|Chromecast/i.test(ua)) return "Android TV";
  if (/iPhone|iPad/i.test(ua)) return "iPhone/iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/HeadlessChrome/i.test(ua)) return "бот/тест";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Linux";
  return ua ? ua.slice(0, 30) : "?";
}

export async function allDevices(db: Db) {
  return db.select({
    id: devices.id, name: devices.name, hw: devices.hw, fw: devices.fw, online: devices.online, lastSeenAt: devices.lastSeenAt,
    modelId: devices.modelId, inverterSerial: devices.inverterSerial, stickSerial: devices.stickSerial, fwChannel: devices.fwChannel,
    orgId: devices.orgId, orgName: organizations.name, createdAt: devices.createdAt,
  }).from(devices).leftJoin(organizations, eq(devices.orgId, organizations.id)).orderBy(desc(devices.lastSeenAt));
}

export async function allPayments(db: Db, limit = 100) {
  return db.select({
    id: payments.id, orgId: payments.orgId, orgName: organizations.name, planId: payments.planId, months: payments.months, amount: payments.amount,
    status: payments.status, createdAt: payments.createdAt, appliedAt: payments.appliedAt, invoiceId: payments.invoiceId, failureReason: payments.failureReason,
  }).from(payments).leftJoin(organizations, eq(payments.orgId, organizations.id)).orderBy(desc(payments.createdAt)).limit(limit);
}

/** Ручна зміна тарифу (партнерські умови, Max, компенсації). planUntil null = безстроково. */
export async function setOrgPlan(db: Db, orgId: string, planId: string, planUntil: Date | null) {
  const [plan] = await db.select({ id: plans.id }).from(plans).where(eq(plans.id, planId));
  if (!plan) throw badRequest("Unknown plan");
  const [org] = await db.update(organizations).set({ planId, planUntil, reminderSentFor: null }).where(eq(organizations.id, orgId)).returning({ id: organizations.id, planId: organizations.planId, planUntil: organizations.planUntil });
  if (!org) throw notFound("Organization not found");
  return org;
}
void and; void screens; void memberships;
