import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestApp, signUp, api, makeSuperadmin, type TestApp } from "./helpers.ts";
import { organizations } from "../src/db/schema.ts";
import { sendExpiryReminders, notifyExpired } from "../src/billing/reminders.ts";
import { expireSubscriptions } from "../src/billing/service.ts";
import type { Mail } from "../src/mail/index.ts";

let t: TestApp;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(async () => { await t.close(); });

describe("панель суперадміна і нагадування", () => {
  let admin: ReturnType<typeof api>, owner: ReturnType<typeof api>, orgId: string;
  const mails: Mail[] = []; const mailer = async (m: Mail) => { mails.push(m); };
  beforeAll(async () => {
    const a = await signUp(t.app, "admin@example.com"); await makeSuperadmin(t, a.userId); admin = api(t.app, a.cookie);
    const o = await signUp(t.app, "owner@example.com"); owner = api(t.app, o.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Кавʼярня" })).json().id;
    const reg = (await admin.post("/api/admin/devices", { id: "3494546462e6" })).json();
    await owner.post(`/api/orgs/${orgId}/devices/claim`, { code: reg.claimCode });
    await owner.post(`/api/orgs/${orgId}/screens`, { name: "Зал" });
  });

  it("огляд: організації з власниками, лічильниками; лише superadmin", async () => {
    expect((await owner.get("/api/admin/overview")).statusCode).toBe(403);
    const r = await admin.get("/api/admin/overview");
    expect(r.statusCode).toBe(200);
    const o = r.json().orgs.find((x: { id: string }) => x.id === orgId);
    expect(o).toMatchObject({ name: "Кавʼярня", planId: "free", devices: 1, screens: 1, owners: "owner@example.com", paid: 0 });
    expect(r.json().totals).toMatchObject({ orgs: 1, users: 2, devices: 1, unclaimed: 0 });
    expect((await admin.get("/api/admin/devices/all")).json()[0]).toMatchObject({ id: "3494546462e6", orgName: "Кавʼярня" });
    expect((await admin.get("/api/admin/payments")).json()).toEqual([]);
  });

  it("ручна зміна тарифу: Max безстроково, потім Pro до дати", async () => {
    expect((await admin.patch(`/api/admin/orgs/${orgId}/plan`, { planId: "max", planUntil: null })).json()).toMatchObject({ planId: "max", planUntil: null });
    expect((await owner.get(`/api/orgs/${orgId}`)).json().plan.id).toBe("max");
    expect((await admin.patch(`/api/admin/orgs/${orgId}/plan`, { planId: "nope", planUntil: null })).statusCode).toBe(400);
    const until = new Date(Date.now() + 2 * 86400_000).toISOString();
    expect((await admin.patch(`/api/admin/orgs/${orgId}/plan`, { planId: "pro", planUntil: until })).statusCode).toBe(200);
  });

  it("нагадування за 3 дні: один лист власнику, повторно не шле; після зміни терміну — знову", async () => {
    expect(await sendExpiryReminders(t.db, mailer, "https://tv.example")).toBe(1);
    expect(mails[0]!.to).toBe("owner@example.com");
    expect(mails[0]!.subject).toMatch(/PRO.*Кавʼярня.*закінчується/);
    expect(mails[0]!.text).toContain(`https://tv.example/o/${orgId}/settings`);
    expect(await sendExpiryReminders(t.db, mailer, "https://tv.example")).toBe(0);
    await t.db.update(organizations).set({ planUntil: new Date(Date.now() + 1 * 86400_000) }).where(eq(organizations.id, orgId));
    expect(await sendExpiryReminders(t.db, mailer, "https://tv.example")).toBe(1);
    // далеко до кінця — не шле
    await t.db.update(organizations).set({ planUntil: new Date(Date.now() + 30 * 86400_000), reminderSentFor: null }).where(eq(organizations.id, orgId));
    expect(await sendExpiryReminders(t.db, mailer, "https://tv.example")).toBe(0);
  });

  it("прострочення: пониження + лист", async () => {
    await t.db.update(organizations).set({ planUntil: new Date(Date.now() - 1000) }).where(eq(organizations.id, orgId));
    const ids = await expireSubscriptions(t.db);
    expect(ids).toEqual([orgId]);
    const before = mails.length;
    await notifyExpired(t.db, mailer, "https://tv.example", ids);
    expect(mails.length).toBe(before + 1);
    expect(mails.at(-1)!.subject).toContain("закінчилась");
  });
});
