/** Ідемпотентний seed: тарифи та відомі моделі інверторів. */
import { sql as raw } from "drizzle-orm";
import { maps } from "@deye/register-maps";
import { inverterModels, plans } from "./schema.ts";
import type { PgDatabase } from "drizzle-orm/pg-core";

export async function seed(db: PgDatabase<any, any, any>) {
await db.insert(plans).values([
  // Free і Pro: однаковий функціонал, різниця в кількості екранів/логерів; Free додатково з брендингом на екрані
  { id: "free", name: "Free", priceMonth: null, limits: { screens: 1, devices: 1, custom_backgrounds: true, history_days: 365, radio: true, branding: true, menus: 1, ai_dishes: 20, ai_generations_month: 60 } },
  { id: "pro", name: "Pro", priceMonth: 60000, limits: { screens: 5, devices: 5, custom_backgrounds: true, history_days: 365, radio: true, branding: false, menus: 5, ai_dishes: 200, ai_generations_month: 600 } },
  { id: "max", name: "Max", priceMonth: null, limits: { screens: 50, devices: 50, custom_backgrounds: true, history_days: 730, radio: true, branding: false, menus: 50, ai_dishes: 1000, ai_generations_month: 5000 } },
]).onConflictDoUpdate({ target: plans.id, set: { name: raw.raw("excluded.name"), limits: raw.raw("excluded.limits"), priceMonth: raw.raw("excluded.price_month") } });

for (const m of Object.values(maps)) {
  await db.insert(inverterModels).values({
    id: m.id, name: m.name, deviceType: m.deviceType, pollRanges: m.pollRanges, registerMap: m.fields, derived: m.derived ?? [],
  }).onConflictDoUpdate({
    target: inverterModels.id,
    set: { name: m.name, deviceType: m.deviceType, pollRanges: m.pollRanges, registerMap: m.fields, derived: m.derived ?? [] },
  });
}

}

if (process.argv[1]?.endsWith("seed.ts")) {
  const { db, sql } = await import("./client.ts");
  await seed(db);
  console.log("seed done");
  await sql.end();
}
