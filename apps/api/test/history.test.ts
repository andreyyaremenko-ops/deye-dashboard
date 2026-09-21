import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestApp, signUp, api, makeSuperadmin, type TestApp } from "./helpers.ts";
import { organizations, plans, telemetry } from "../src/db/schema.ts";
// тест-тариф без радіо/фонів/історії: перевіряємо самі перевірки, бо Free тепер має все на 1 екран/логер
const LITE = { id: "lite", name: "Lite", priceMonth: null, limits: { screens: 1, devices: 1, custom_backgrounds: false, history_days: 0, radio: false, branding: true, menus: 1, ai_dishes: 0, ai_generations_month: 0 } };

import { runRetention } from "../src/history/service.ts";

let t: TestApp;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(async () => { await t.close(); });

describe("історія і ретенція за тарифом", () => {
  let owner: ReturnType<typeof api>, orgId: string, token: string;
  const D = "3494546462e6";
  beforeAll(async () => {
    const a = await signUp(t.app, "admin@example.com"); await makeSuperadmin(t, a.userId);
    const reg = (await api(t.app, a.cookie).post("/api/admin/devices", { id: D })).json();
    const o = await signUp(t.app, "o@example.com"); owner = api(t.app, o.cookie);
    orgId = (await owner.post("/api/orgs", { name: "O" })).json().id;
    await owner.post(`/api/orgs/${orgId}/devices/claim`, { code: reg.claimCode });
    // 48 годин точок кожні 10 хв: pv_w синусоїда, load_w 1000, pv_day_kwh росте
    const rows: typeof telemetry.$inferInsert[] = [];
    const now = Date.now();
    for (let m = 0; m < 48 * 60; m += 10) {
      const time = new Date(now - m * 60_000);
      rows.push({ time, deviceId: D, metric: "pv_w", value: 500 + 500 * Math.sin(m / 100) }, { time, deviceId: D, metric: "load_w", value: 1000 }, { time, deviceId: D, metric: "pv_day_kwh", value: (m % 1440) / 100 });
    }
    rows.push({ time: new Date(now - 10 * 86400_000), deviceId: D, metric: "pv_w", value: 1 }); // старий рядок
    await t.db.insert(telemetry).values(rows);
    const s = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "S", config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [{ id: "c", type: "chart", x: 0, y: 0, w: 40, h: 30, deviceId: D, props: {} }] } })).json();
    token = s.viewToken;
  });

  it("тариф без історії: 409 plan_limit, і публічно теж", async () => {
    await t.db.insert(plans).values(LITE);
    await t.db.update(organizations).set({ planId: "lite" }).where(eq(organizations.id, orgId));
    const r = await owner.get(`/api/orgs/${orgId}/devices/${D}/history`);
    expect(r.statusCode).toBe(409); expect(r.json().error).toBe("plan_limit");
    expect((await t.app.inject({ method: "GET", url: `/api/public/screens/${token}/history?deviceId=${D}` })).statusCode).toBe(409);
  });

  it("pro: серії по бакетах, денні підсумки, обрізання глибини", async () => {
    await t.db.update(organizations).set({ planId: "pro" }).where(eq(organizations.id, orgId));
    const r = await owner.get(`/api/orgs/${orgId}/devices/${D}/history?metrics=pv_w,load_w&step=1h`);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.points.length).toBeGreaterThanOrEqual(24);
    expect(b.points.length).toBeLessThanOrEqual(26);
    expect(b.points[0].load_w).toBe(1000);
    expect(b.historyDays).toBe(365);
    const wide = (await owner.get(`/api/orgs/${orgId}/devices/${D}/history?metrics=pv_w&step=1d&from=2020-01-01T00:00:00Z`)).json();
    expect(new Date(wide.from).getTime()).toBeGreaterThan(Date.now() - 366 * 86400_000);
    const d = (await owner.get(`/api/orgs/${orgId}/devices/${D}/history/daily?days=7`)).json();
    expect(d.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...d.map((x: { pv_day_kwh?: number }) => x.pv_day_kwh ?? 0))).toBeGreaterThan(10);
    const pub = (await t.app.inject({ method: "GET", url: `/api/public/screens/${token}/history?deviceId=${D}&hours=24&step=15m` })).json();
    expect(pub.points.length).toBeGreaterThanOrEqual(90);
    expect((await t.app.inject({ method: "GET", url: `/api/public/screens/${token}/history?deviceId=aabbccddeeff` })).statusCode).toBe(403);
    expect((await owner.get(`/api/orgs/${orgId}/devices/${D}/history?metrics=pv_w;drop&step=1h`)).statusCode).toBe(400);
  });

  it("ретенція: pro і free лишають 365 днів, тариф без історії — 2 доби", async () => {
    expect(await runRetention(t.db)).toBe(0); // pro: 10-денний рядок у межах 365
    await t.db.update(organizations).set({ planId: "free" }).where(eq(organizations.id, orgId));
    expect(await runRetention(t.db)).toBe(0); // free тепер теж з історією за рік
    await t.db.update(organizations).set({ planId: "lite" }).where(eq(organizations.id, orgId));
    const deleted = await runRetention(t.db);
    expect(deleted).toBe(1); // лише 10-денний рядок, 48 год лишаються
  });
});
