/**
 * Листи власникам: за 3 дні до кінця підписки і після пониження на Free.
 * Один лист на один термін (reminder_sent_for = plan_until, для якого вже надіслано).
 */
import { and, eq, gt, lt, ne, isNotNull, or, isNull } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { memberships, organizations, user } from "../db/schema.ts";
import type { Mailer } from "../mail/index.ts";

type Db = PgDatabase<any, any, any>;
const DAY = 86400_000;

async function ownerEmails(db: Db, orgId: string): Promise<string[]> {
  const rows = await db.select({ email: user.email }).from(memberships).innerJoin(user, eq(memberships.userId, user.id))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
  return rows.map((r) => r.email);
}

const fmt = (d: Date) => d.toLocaleDateString("uk-UA", { day: "numeric", month: "long", year: "numeric" });

/** Нагадування: plan_until у найближчі 3 дні, ще не нагадували про цей термін. */
export async function sendExpiryReminders(db: Db, mailer: Mailer, publicUrl: string, now = new Date()): Promise<number> {
  const soon = new Date(now.getTime() + 3 * DAY);
  const orgs = await db.select({ id: organizations.id, name: organizations.name, planId: organizations.planId, planUntil: organizations.planUntil, sentFor: organizations.reminderSentFor })
    .from(organizations)
    .where(and(ne(organizations.planId, "free"), isNotNull(organizations.planUntil), gt(organizations.planUntil, now), lt(organizations.planUntil, soon)));
  let sent = 0;
  for (const o of orgs) {
    if (o.sentFor && o.planUntil && o.sentFor.getTime() === o.planUntil.getTime()) continue;
    const emails = await ownerEmails(db, o.id);
    for (const to of emails) {
      await mailer({
        to,
        subject: `SunHunter TV: підписка ${o.planId.toUpperCase()} для «${o.name}» закінчується ${fmt(o.planUntil!)}`,
        text: `Підписка ${o.planId.toUpperCase()} для закладу «${o.name}» діє до ${fmt(o.planUntil!)}.\n\nПісля цього екран перейде на Free: один екран, без радіо, власних фонів та графіків.\n\nПродовжити можна в кабінеті: ${publicUrl}/o/${o.id}/settings\n\nSunHunter TV`,
        html: `<p>Підписка <b>${o.planId.toUpperCase()}</b> для закладу «${o.name}» діє до <b>${fmt(o.planUntil!)}</b>.</p><p>Після цього екран перейде на Free: один екран, без радіо, власних фонів та графіків.</p><p><a href="${publicUrl}/o/${o.id}/settings">Продовжити в кабінеті</a></p><p>SunHunter TV</p>`,
      });
      sent++;
    }
    await db.update(organizations).set({ reminderSentFor: o.planUntil }).where(eq(organizations.id, o.id));
  }
  return sent;
}

/** Після пониження: лист "підписка закінчилась". Повертає список знижених org id. */
export async function notifyExpired(db: Db, mailer: Mailer, publicUrl: string, orgIds: string[]) {
  for (const id of orgIds) {
    const [o] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, id));
    if (!o) continue;
    for (const to of await ownerEmails(db, id)) {
      await mailer({
        to, subject: `SunHunter TV: підписка для «${o.name}» закінчилась`,
        text: `Термін оплати для закладу «${o.name}» минув, екран працює на тарифі Free.\n\nПовернути Pro: ${publicUrl}/o/${id}/settings\n\nSunHunter TV`,
      });
    }
  }
}
void or; void isNull;
