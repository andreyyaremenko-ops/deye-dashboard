import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(async () => { await t.close(); });

describe("auth + організації + ролі", () => {
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>, outsider: ReturnType<typeof api>;
  let ownerId: string, staffId: string, orgId: string;

  it("реєстрація і /api/me", async () => {
    const o = await signUp(t.app, "owner@example.com"); ownerId = o.userId; owner = api(t.app, o.cookie);
    const s = await signUp(t.app, "staff@example.com"); staffId = s.userId; staff = api(t.app, s.cookie);
    const x = await signUp(t.app, "outsider@example.com"); outsider = api(t.app, x.cookie);
    const me = await owner.get("/api/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe("owner@example.com");
    expect(me.json().orgs).toEqual([]);
    expect((await t.app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });

  it("створення організації робить автора owner, тариф free", async () => {
    const res = await owner.post("/api/orgs", { name: "Кафе Сонце" });
    expect(res.statusCode).toBe(201);
    orgId = res.json().id;
    const org = await owner.get(`/api/orgs/${orgId}`);
    expect(org.json().role).toBe("owner");
    expect(org.json().plan.id).toBe("free");
    expect((await outsider.get(`/api/orgs/${orgId}`)).statusCode).toBe(403);
  });

  it("запрошення: одноразове посилання, staff за замовчуванням", async () => {
    const inv = await owner.post(`/api/orgs/${orgId}/invites`, {});
    expect(inv.statusCode).toBe(201);
    expect(inv.json().role).toBe("staff");
    expect(inv.json().url).toContain("/invite/");
    const token = inv.json().token as string;

    const acc = await staff.post(`/api/invites/${token}/accept`);
    expect(acc.statusCode).toBe(200);
    expect(acc.json()).toEqual({ orgId, role: "staff" });
    // повторно — використане
    expect((await outsider.post(`/api/invites/${token}/accept`)).statusCode).toBe(409);
    expect((await outsider.post(`/api/invites/nope-nope-nope/accept`)).statusCode).toBe(404);
  });

  it("staff не може запрошувати і прибирати; бачить учасників", async () => {
    expect((await staff.post(`/api/orgs/${orgId}/invites`, {})).statusCode).toBe(403);
    expect((await staff.del(`/api/orgs/${orgId}/members/${ownerId}`)).statusCode).toBe(403);
    const members = await staff.get(`/api/orgs/${orgId}/members`);
    expect(members.json().map((m: { role: string }) => m.role).sort()).toEqual(["owner", "staff"]);
  });

  it("owner не може прибрати останнього owner, але може прибрати staff", async () => {
    expect((await owner.del(`/api/orgs/${orgId}/members/${ownerId}`)).statusCode).toBe(409);
    expect((await owner.patch(`/api/orgs/${orgId}/members/${ownerId}`, { role: "staff" })).statusCode).toBe(409);
    expect((await owner.del(`/api/orgs/${orgId}/members/${staffId}`)).statusCode).toBe(204);
    expect((await staff.get(`/api/orgs/${orgId}`)).statusCode).toBe(403);
  });

  it("magic link відправляє лист із посиланням", async () => {
    const res = await t.app.inject({
      method: "POST", url: "/api/auth/sign-in/magic-link",
      headers: { origin: "http://localhost:5173", "content-type": "application/json" },
      payload: { email: "owner@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(t.mails.at(-1)?.to).toBe("owner@example.com");
    expect(t.mails.at(-1)?.text).toMatch(/http:\/\/localhost:5173\/api\/auth\/magic-link\/verify\?token=/);
  });
});
