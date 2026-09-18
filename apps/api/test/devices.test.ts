import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations } from "../src/db/schema.ts";
import { makeTestApp, signUp, api, makeSuperadmin, INTERNAL, type TestApp } from "./helpers.ts";
import { ACC, mqttAclCheck } from "../src/mqtt/acl.ts";

let t: TestApp;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(async () => { await t.close(); });

describe("реєстрація, claim, ACL брокера", () => {
  let admin: ReturnType<typeof api>, ownerA: ReturnType<typeof api>, ownerB: ReturnType<typeof api>, staffA: ReturnType<typeof api>;
  let orgA: string, orgB: string;
  let reg: { deviceId: string; secret: string; claimCode: string };

  beforeAll(async () => {
    const a = await signUp(t.app, "admin@example.com"); await makeSuperadmin(t, a.userId); admin = api(t.app, a.cookie);
    const oa = await signUp(t.app, "a@example.com"); ownerA = api(t.app, oa.cookie);
    const ob = await signUp(t.app, "b@example.com"); ownerB = api(t.app, ob.cookie);
    orgA = (await ownerA.post("/api/orgs", { name: "A" })).json().id;
    orgB = (await ownerB.post("/api/orgs", { name: "B" })).json().id;
    const inv = (await ownerA.post(`/api/orgs/${orgA}/invites`, { role: "staff" })).json().token;
    const sa = await signUp(t.app, "staffa@example.com"); staffA = api(t.app, sa.cookie);
    await staffA.post(`/api/invites/${inv}/accept`);
  });

  it("реєстрація пристрою лише для superadmin, секрет і код видаються один раз", async () => {
    expect((await ownerA.post("/api/admin/devices", { id: "3494546462e6" })).statusCode).toBe(403);
    const res = await admin.post("/api/admin/devices", { id: "3494546462E6", hw: "esp8266" });
    expect(res.statusCode).toBe(201);
    reg = res.json();
    expect(reg.deviceId).toBe("3494546462e6");
    expect(reg.claimCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(reg.secret.length).toBeGreaterThan(20);
    expect((await admin.post("/api/admin/devices", { id: "3494546462e6" })).statusCode).toBe(409);
  });

  it("claim by code: код з дефісами і малими літерами теж підходить", async () => {
    const pretty = reg.claimCode.toLowerCase().slice(0, 4) + "-" + reg.claimCode.slice(4);
    const res = await ownerA.post(`/api/orgs/${orgA}/devices/claim`, { code: pretty, name: "Інвертор у залі" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: "3494546462e6", orgId: orgA, name: "Інвертор у залі" });
    const list = await staffA.get(`/api/orgs/${orgA}/devices`);
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].stale).toBe(true);
  });

  it("free: другий логер не привʼязується (409 plan_limit); після переходу на pro — так", async () => {
    const reg2 = (await admin.post("/api/admin/devices", { id: "3494546462e7" })).json();
    const r = await ownerA.post(`/api/orgs/${orgA}/devices/claim`, { code: reg2.claimCode });
    expect(r.statusCode).toBe(409); expect(r.json().error).toBe("plan_limit");
    await t.db.update(organizations).set({ planId: "pro" }).where(eq(organizations.id, orgA));
    expect((await ownerA.post(`/api/orgs/${orgA}/devices/claim`, { code: reg2.claimCode })).statusCode).toBe(201);
    expect((await ownerA.post(`/api/orgs/${orgA}/devices/${reg2.deviceId}/unclaim`)).statusCode).toBe(204);
    await t.db.update(organizations).set({ planId: "free" }).where(eq(organizations.id, orgA));
  });

  it("чужа організація не може забрати привʼязаний пристрій; невірний код -> 404", async () => {
    expect((await ownerB.post(`/api/orgs/${orgB}/devices/claim`, { code: reg.claimCode })).statusCode).toBe(409);
    expect((await ownerB.post(`/api/orgs/${orgB}/devices/claim`, { code: "ZZZZZZZZ" })).statusCode).toBe(404);
    expect((await ownerB.get(`/api/orgs/${orgB}/devices`)).json()).toHaveLength(0);
  });

  it("staff не може claim/unclaim; owner може unclaim, після чого інша організація може claim", async () => {
    expect((await staffA.post(`/api/orgs/${orgA}/devices/claim`, { code: reg.claimCode })).statusCode).toBe(403);
    expect((await staffA.post(`/api/orgs/${orgA}/devices/${reg.deviceId}/unclaim`)).statusCode).toBe(403);
    expect((await ownerA.post(`/api/orgs/${orgA}/devices/${reg.deviceId}/unclaim`)).statusCode).toBe(204);
    expect((await ownerB.post(`/api/orgs/${orgB}/devices/claim`, { code: reg.claimCode })).statusCode).toBe(201);
    expect((await ownerA.get(`/api/orgs/${orgA}/devices/${reg.deviceId}/state`)).statusCode).toBe(404);
  });

  it("mqtt auth: секрет пристрою, внутрішній користувач, чужі — ні", async () => {
    const auth = (username: string, password: string) =>
      t.app.inject({ method: "POST", url: "/internal/mqtt/auth", payload: { username, password } });
    expect((await auth(reg.deviceId, reg.secret)).statusCode).toBe(200);
    expect((await auth(reg.deviceId, "wrong")).statusCode).toBe(401);
    expect((await auth("unknown00000", reg.secret)).statusCode).toBe(401);
    expect((await auth(INTERNAL.user, INTERNAL.pass)).statusCode).toBe(200);
    expect((await auth(INTERNAL.user, "nope")).statusCode).toBe(401);
    // з публічної адреси /internal закритий
    const ext = await t.app.inject({ method: "POST", url: "/internal/mqtt/auth", payload: { username: reg.deviceId, password: reg.secret }, remoteAddress: "8.8.8.8" });
    expect(ext.statusCode).toBe(403);
  });

  it("mqtt acl: пристрій пише лише у свої теми, читає лише cfg/cmd", () => {
    const id = "3494546462e6";
    expect(mqttAclCheck(id, `devices/${id}/telemetry`, ACC.WRITE)).toBe(true);
    expect(mqttAclCheck(id, `devices/${id}/status`, ACC.WRITE)).toBe(true);
    expect(mqttAclCheck(id, `devices/${id}/cfg`, ACC.WRITE)).toBe(false);
    expect(mqttAclCheck(id, `devices/${id}/cfg`, ACC.READ)).toBe(true);
    expect(mqttAclCheck(id, `devices/${id}/cmd`, ACC.SUBSCRIBE)).toBe(true);
    expect(mqttAclCheck(id, `devices/${id}/telemetry`, ACC.READ)).toBe(false);
    expect(mqttAclCheck(id, `devices/aabbccddeeff/telemetry`, ACC.WRITE)).toBe(false);
    expect(mqttAclCheck(id, `devices/+/telemetry`, ACC.SUBSCRIBE)).toBe(false);
    expect(mqttAclCheck(id, `devices/#`, ACC.SUBSCRIBE)).toBe(false);
    expect(mqttAclCheck(id, `$SYS/broker/uptime`, ACC.READ)).toBe(false);
  });

  it("mqtt acl endpoint: superuser api, пристрій за правилами", async () => {
    const acl = (username: string, topic: string, acc: number) =>
      t.app.inject({ method: "POST", url: "/internal/mqtt/acl", payload: { username, topic, acc, clientid: username } });
    expect((await acl(INTERNAL.user, "devices/+/telemetry", ACC.SUBSCRIBE)).statusCode).toBe(200);
    expect((await acl(reg.deviceId, `devices/${reg.deviceId}/info`, ACC.WRITE)).statusCode).toBe(200);
    expect((await acl(reg.deviceId, `devices/+/telemetry`, ACC.SUBSCRIBE)).statusCode).toBe(403);
  });
});
