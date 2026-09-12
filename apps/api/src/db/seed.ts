/** Ідемпотентний seed: тарифи та відомі моделі інверторів. */
import { sql as raw } from "drizzle-orm";
import { maps } from "@deye/register-maps";
import { inverterModels, plans } from "./schema.ts";
import type { PgDatabase } from "drizzle-orm/pg-core";

export async function seed(db: PgDatabase<any, any, any>) {
await db.insert(plans).values([
  { id: "free", name: "Free", limits: { screens: 1, custom_backgrounds: false, history_days: 0, radio: false, branding: true } },
  { id: "pro", name: "Pro", limits: { screens: 5, custom_backgrounds: true, history_days: 365, radio: true, branding: false } },
]).onConflictDoUpdate({ target: plans.id, set: { name: raw.raw("excluded.name"), limits: raw.raw("excluded.limits") } });

for (const m of Object.values(maps)) {
  await db.insert(inverterModels).values({
    id: m.id, name: m.name, deviceType: m.deviceType, pollRanges: m.pollRanges, registerMap: m.fields,
  }).onConflictDoUpdate({
    target: inverterModels.id,
    set: { name: m.name, deviceType: m.deviceType, pollRanges: m.pollRanges, registerMap: m.fields },
  });
}

}

if (process.argv[1]?.endsWith("seed.ts")) {
  const { db, sql } = await import("./client.ts");
  await seed(db);
  console.log("seed done");
  await sql.end();
}
