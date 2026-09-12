import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestApp, signUp, api, makeSuperadmin, type TestApp } from "./helpers.ts";
import { organizations, screens } from "../src/db/schema.ts";

let t: TestApp;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(async () => { await t.close(); });

describe("екрани, тарифні ліміти, публічний токен", () => {
  let owner: ReturnType<typeof api>, other: ReturnType<typeof api>;
  let orgId: string, otherOrg: string, deviceId: string, screenId: string, token: string;

  beforeAll(async () => {
    const a = await signUp(t.app, "admin@example.com"); await makeSuperadmin(t, a.userId);
    const o = await signUp(t.app, "o@example.com"); owner = api(t.app, o.cookie);
    const x = await signUp(t.app, "x@example.com"); other = api(t.app, x.cookie);
    orgId = (await owner.post("/api/orgs", { name: "O" })).json().id;
    otherOrg = (await other.post("/api/orgs", { name: "X" })).json().id;
    const reg = (await api(t.app, a.cookie).post("/api/admin/devices", { id: "3494546462e6" })).json();
    deviceId = reg.deviceId;
    await owner.post(`/api/orgs/${orgId}/devices/claim`, { code: reg.claimCode });
    await t.store.set({ deviceId, updatedAt: new Date().toISOString(), metrics: { pv_w: 710, bat_soc: 96 } });
  });

  it("free: один екран, радіо недоступне, віджет на чужий пристрій відхиляється", async () => {
    const res = await owner.post(`/api/orgs/${orgId}/screens`, {
      name: "Зал", config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [{ id: "w1", type: "pv", x: 0, y: 0, w: 30, h: 20, deviceId, props: {} }] },
    });
    expect(res.statusCode).toBe(201);
    screenId = res.json().id; token = res.json().viewToken;
    expect(token.length).toBeGreaterThan(30);
    expect((await owner.post(`/api/orgs/${orgId}/screens`, { name: "Другий" })).statusCode).toBe(409);
    expect((await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: { backgroundId: null, radioUrl: "https://radio.example/stream", theme: "dark", widgets: [] } })).statusCode).toBe(409);
    const foreign = await other.post(`/api/orgs/${otherOrg}/screens`, {
      name: "Чужий", config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [{ id: "w", type: "pv", x: 0, y: 0, w: 10, h: 10, deviceId, props: {} }] },
    });
    expect(foreign.statusCode).toBe(400);
  });

  it("pro дозволяє радіо зі списку станцій, гучність за замовчуванням 0.6", async () => {
    await t.db.update(organizations).set({ planId: "pro" }).where(eq(organizations.id, orgId));
    const radio = (await t.app.inject({ method: "GET", url: "/api/radio" })).json();
    expect(radio.length).toBe(14);
    const res = await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: { backgroundId: null, radioUrl: radio[0].url, theme: "dark", widgets: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().config.radioVolume).toBe(0.6);
    await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [{ id: "w1", type: "pv", x: 0, y: 0, w: 30, h: 20, deviceId, props: {} }] } });
    await t.db.update(organizations).set({ planId: "free" }).where(eq(organizations.id, orgId));
  });

  it("публічний екран без логіну віддає конфіг і стан, але не організацію", async () => {
    const res = await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deviceIds).toEqual([deviceId]);
    expect(body.states[0].metrics.pv_w).toBe(710);
    expect(body.states[0].stale).toBe(false);
    expect(body.branding).toBe(true);
    expect(JSON.stringify(body)).not.toContain(orgId);
    expect((await t.app.inject({ method: "GET", url: `/api/public/screens/${"x".repeat(43)}` })).statusCode).toBe(404);
  });

  it("перевипуск токена інвалідує старий", async () => {
    const res = await owner.post(`/api/orgs/${orgId}/screens/${screenId}/rotate-token`);
    expect(res.statusCode).toBe(200);
    const fresh = res.json().viewToken;
    expect(fresh).not.toBe(token);
    expect((await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/api/public/screens/${fresh}` })).statusCode).toBe(200);
    token = fresh;
  });

  it("код для ТБ: 6 цифр, 15 хв, віддає токен; невірний/прострочений — 404; перевипуск токена скидає код", async () => {
    const r = await owner.post(`/api/orgs/${orgId}/screens/${screenId}/pair-code`);
    expect(r.statusCode).toBe(200);
    const { code, expiresAt } = r.json();
    expect(code).toMatch(/^\d{6}$/);
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(14 * 60_000);
    const pair = await t.app.inject({ method: "POST", url: "/api/public/pair", payload: { code: code.slice(0, 3) + " " + code.slice(3) } });
    expect(pair.statusCode).toBe(200);
    expect(pair.json().token).toBe(token);
    expect((await t.app.inject({ method: "POST", url: "/api/public/pair", payload: { code: "000000" === code ? "111111" : "000000" } })).statusCode).toBe(404);
    // прострочення
    await t.db.update(screens).set({ pairCodeExpiresAt: new Date(Date.now() - 1000) }).where(eq(screens.id, screenId));
    expect((await t.app.inject({ method: "POST", url: "/api/public/pair", payload: { code } })).statusCode).toBe(404);
    // новий код, потім перевипуск токена скидає його
    const code2 = (await owner.post(`/api/orgs/${orgId}/screens/${screenId}/pair-code`)).json().code;
    await owner.post(`/api/orgs/${orgId}/screens/${screenId}/rotate-token`);
    expect((await t.app.inject({ method: "POST", url: "/api/public/pair", payload: { code: code2 } })).statusCode).toBe(404);
    token = (await owner.get(`/api/orgs/${orgId}/screens`)).json().find((s: { id: string }) => s.id === screenId).viewToken;
  });

  it("після unclaim пристрій зникає з публічного екрана", async () => {
    await owner.post(`/api/orgs/${orgId}/devices/${deviceId}/unclaim`);
    const body = (await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` })).json();
    expect(body.deviceIds).toEqual([]);
    expect(body.states).toEqual([]);
  });

  it("чужий не бачить і не редагує екран", async () => {
    expect((await other.get(`/api/orgs/${orgId}/screens`)).statusCode).toBe(403);
    expect((await other.del(`/api/orgs/${orgId}/screens/${screenId}`)).statusCode).toBe(403);
  });
});
