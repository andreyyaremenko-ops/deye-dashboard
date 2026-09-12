/**
 * DDL з усіх міграцій і seed проганяються в PGlite (Postgres у WASM).
 * Timescale-міграція 0001 тут не виконується — її перевіряє деплой.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { schema, devices, inverterModels, plans, organizations, telemetry, deviceState } from "../src/db/schema.ts";
import { seed } from "../src/db/seed.ts";

const dir = join(import.meta.dirname, "../drizzle");
const pg = new PGlite();
const db = drizzle(pg, { schema });

beforeAll(async () => {
  // усі міграції, крім Timescale (її перевіряє деплой)
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && !f.includes("timescale")).sort()) {
    for (const stmt of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  await seed(db);
});

describe("схема + seed", () => {
  it("тарифи і моделі засіяні, seed ідемпотентний", async () => {
    await seed(db);
    expect((await db.select().from(plans)).map((p) => p.id).sort()).toEqual(["free", "pro"]);
    const models = await db.select().from(inverterModels);
    expect(models.map((m) => m.id)).toEqual(["deye-hp3"]);
    expect(models[0]!.registerMap.length).toBeGreaterThan(50);
  });

  it("організація за замовчуванням на free, пристрій без організації, стан", async () => {
    const [org] = await db.insert(organizations).values({ name: "Кафе" }).returning();
    expect(org!.planId).toBe("free");
    await db.insert(devices).values({ id: "3494546462e6", secretHash: "x", claimCodeHash: "y", hw: "esp8266" });
    const [d] = await db.select().from(devices).where(eq(devices.id, "3494546462e6"));
    expect(d!.orgId).toBeNull();
    expect(d!.online).toBe(false);
    await db.insert(deviceState).values({ deviceId: d!.id, updatedAt: new Date(), state: { pv_w: 710, stale: false } });
    await db.insert(telemetry).values({ time: new Date(), deviceId: d!.id, metric: "pv_w", value: 710 });
    await db.delete(devices).where(eq(devices.id, d!.id));
    expect(await db.select().from(telemetry)).toHaveLength(0); // cascade
    expect(await db.select().from(deviceState)).toHaveLength(0);
  });

  it("FK: пристрій на неіснуючу модель відхиляється", async () => {
    await expect(
      db.insert(devices).values({ id: "bad", secretHash: "x", claimCodeHash: "y", modelId: "nope" }),
    ).rejects.toThrow();
  });
});
