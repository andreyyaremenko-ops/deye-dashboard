/**
 * Підписки: checkout -> інвойс monobank -> вебхук/статус -> продовження plan_until.
 * Тариф діє до plan_until; після — щоденна джоба повертає free.
 */
import { and, desc, eq, lt, isNotNull, ne } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { organizations, payments, plans } from "../db/schema.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";
import { requireRole } from "../orgs/service.ts";
import type { MonoClient, MonoInvoiceStatus } from "./mono.ts";

type Db = PgDatabase<any, any, any>;
export const MONTHS_ALLOWED = [1, 3, 6, 12] as const;
/** Скільки місяців оплачується за період: 6 = 5 (місяць у подарунок), 12 = 10 (два місяці). */
export const BILLABLE_MONTHS: Record<number, number> = { 1: 1, 3: 3, 6: 5, 12: 10 };
export const priceFor = (priceMonth: number, months: number) => priceMonth * (BILLABLE_MONTHS[months] ?? months);

export interface BillingDeps { db: Db; mono: MonoClient | null; publicUrl: string; log?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void } }

export async function billingInfo(db: Db, orgId: string) {
  const [org] = await db.select({ planId: organizations.planId, planUntil: organizations.planUntil }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw notFound("Organization not found");
  const allPlans = await db.select({ id: plans.id, name: plans.name, priceMonth: plans.priceMonth, limits: plans.limits }).from(plans);
  const list = await db.select({ id: payments.id, planId: payments.planId, months: payments.months, amount: payments.amount, status: payments.status, createdAt: payments.createdAt, appliedAt: payments.appliedAt, pageUrl: payments.pageUrl })
    .from(payments).where(eq(payments.orgId, orgId)).orderBy(desc(payments.createdAt)).limit(20);
  const pro = allPlans.find((p) => p.id === "pro");
  const options = MONTHS_ALLOWED.map((m) => ({ months: m, amount: pro?.priceMonth ? priceFor(pro.priceMonth, m) : 0, freeMonths: m - (BILLABLE_MONTHS[m] ?? m) }));
  return { planId: org.planId, planUntil: org.planUntil, plans: allPlans, payments: list, months: MONTHS_ALLOWED, options };
}

/** Створити інвойс на N місяців Pro. Повертає pageUrl для редиректу. */
export async function checkout(deps: BillingDeps, orgId: string, userId: string, planId: string, months: number) {
  await requireRole(deps.db, orgId, userId, "owner");
  if (!deps.mono) throw conflict("Online payments are not configured", "billing_disabled");
  if (!(MONTHS_ALLOWED as readonly number[]).includes(months)) throw badRequest("months must be 1, 3, 6 or 12");
  const [plan] = await deps.db.select().from(plans).where(eq(plans.id, planId));
  if (!plan || !plan.priceMonth) throw badRequest("This plan is not sold online", "plan_not_sellable");
  const amount = priceFor(plan.priceMonth, months);
  const [p] = await deps.db.insert(payments).values({ orgId, userId, planId, months, amount }).returning();
  const reference = p!.id;
  try {
    const inv = await deps.mono.createInvoice({
      amount, reference,
      destination: `SunHunter TV ${plan.name}, ${months} міс.`,
      redirectUrl: `${deps.publicUrl}/app/billing/${orgId}?payment=${reference}`,
      webHookUrl: `${deps.publicUrl}/api/billing/mono/webhook`,
      basket: [{ name: `Підписка ${plan.name} (${months} міс.)`, qty: 1, sum: amount, code: `${plan.id}-${months}m` }],
    });
    await deps.db.update(payments).set({ invoiceId: inv.invoiceId, pageUrl: inv.pageUrl, updatedAt: new Date() }).where(eq(payments.id, reference));
    return { paymentId: reference, pageUrl: inv.pageUrl, amount };
  } catch (e) {
    await deps.db.update(payments).set({ status: "failure", failureReason: String((e as Error).message).slice(0, 300), updatedAt: new Date() }).where(eq(payments.id, reference));
    throw e;
  }
}

/** Застосувати статус від monobank (вебхук або опитування). Ідемпотентно: success застосовується один раз. */
export async function applyStatus(deps: BillingDeps, s: MonoInvoiceStatus, now = new Date()) {
  const [p] = await deps.db.select().from(payments).where(eq(payments.invoiceId, s.invoiceId));
  if (!p) { deps.log?.warn({ invoiceId: s.invoiceId }, "billing: unknown invoice"); return null; }
  const set: Partial<typeof payments.$inferInsert> = { status: s.status, failureReason: s.failureReason ?? s.errCode ?? null, raw: s as object, updatedAt: now };
  if (s.status === "success" && !p.appliedAt) {
    if ((s.finalAmount ?? s.amount ?? p.amount) < p.amount) { deps.log?.warn({ invoiceId: s.invoiceId }, "billing: amount mismatch"); }
    else {
      await deps.db.transaction(async (tx) => {
        const [org] = await tx.select({ planId: organizations.planId, planUntil: organizations.planUntil }).from(organizations).where(eq(organizations.id, p.orgId)).for("update");
        const base = org?.planId === p.planId && org.planUntil && org.planUntil > now ? org.planUntil : now;
        const until = new Date(base); until.setMonth(until.getMonth() + p.months);
        await tx.update(organizations).set({ planId: p.planId, planUntil: until }).where(eq(organizations.id, p.orgId));
        await tx.update(payments).set({ ...set, appliedAt: now }).where(eq(payments.id, p.id));
      });
      deps.log?.info({ orgId: p.orgId, months: p.months }, "billing: subscription extended");
      return { ...p, status: s.status, appliedAt: now };
    }
  }
  if (s.status === "reversed" && p.appliedAt) {
    // повернення коштів: знімаємо тариф
    await deps.db.update(organizations).set({ planId: "free", planUntil: null }).where(eq(organizations.id, p.orgId));
  }
  await deps.db.update(payments).set(set).where(eq(payments.id, p.id));
  return { ...p, status: s.status };
}

/** Опитати monobank по одному платежу (сторінка повернення). */
export async function refreshPayment(deps: BillingDeps, orgId: string, userId: string, paymentId: string) {
  await requireRole(deps.db, orgId, userId, "staff");
  const [p] = await deps.db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)));
  if (!p) throw notFound("Payment not found");
  if (deps.mono && p.invoiceId && !p.appliedAt && ["created", "processing", "hold"].includes(p.status)) {
    const s = await deps.mono.getStatus(p.invoiceId);
    await applyStatus(deps, s);
    const [fresh] = await deps.db.select().from(payments).where(eq(payments.id, paymentId));
    return fresh!;
  }
  return p;
}

/** Щогодини: прострочені платні тарифи -> free. Повертає id знижених організацій. */
export async function expireSubscriptions(db: Db, now = new Date()): Promise<string[]> {
  const res = await db.update(organizations).set({ planId: "free", planUntil: null })
    .where(and(ne(organizations.planId, "free"), isNotNull(organizations.planUntil), lt(organizations.planUntil, now))).returning({ id: organizations.id });
  return res.map((r) => r.id);
}
