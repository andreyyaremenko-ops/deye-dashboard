import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { eq } from "drizzle-orm";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";
import { createMonoClient, verifyMonoSignature, type MonoClient, type MonoInvoiceStatus } from "../src/billing/mono.ts";
import { expireSubscriptions } from "../src/billing/service.ts";
import { organizations, payments } from "../src/db/schema.ts";

// емуляція monobank: ключ ECDSA, інвойси в памʼяті
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
const invoices = new Map<string, MonoInvoiceStatus>();
let n = 0;
const fakeMono: MonoClient = {
  async createInvoice(i) { const id = `inv_${++n}`; invoices.set(id, { invoiceId: id, status: "created", amount: i.amount, ccy: 980, reference: i.reference }); return { invoiceId: id, pageUrl: `https://pay.mbnk.biz/${id}` }; },
  async getStatus(id) { return invoices.get(id)!; },
  async getPubKey() { return pem; },
};
const signBody = (body: string) => cryptoSign("sha256", Buffer.from(body), privateKey).toString("base64");

let t: TestApp;
beforeAll(async () => { t = await makeTestApp({ mono: fakeMono }); });
afterAll(async () => { await t.close(); });

describe("monobank client", () => {
  it("підпис вебхука перевіряється, зіпсований — ні", () => {
    const body = JSON.stringify({ invoiceId: "x", status: "success" });
    expect(verifyMonoSignature(body, signBody(body), pem)).toBe(true);
    expect(verifyMonoSignature(body + " ", signBody(body), pem)).toBe(false);
    expect(verifyMonoSignature(body, "AAAA", pem)).toBe(false);
  });
  it("createInvoice шле правильні поля з X-Token", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ invoiceId: "i1", pageUrl: "https://p" }), { status: 200 }); }) as unknown as typeof fetch;
    const c = createMonoClient("tok", "https://api.test", fetchFn);
    const r = await c.createInvoice({ amount: 60000, reference: "ref", destination: "d", redirectUrl: "https://r", webHookUrl: "https://w" });
    expect(r.invoiceId).toBe("i1");
    expect(calls[0]!.url).toBe("https://api.test/api/merchant/invoice/create");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Token"]).toBe("tok");
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ amount: 60000, ccy: 980, redirectUrl: "https://r", webHookUrl: "https://w", paymentType: "debit" });
    expect(body.merchantPaymInfo.reference).toBe("ref");
  });
});

describe("підписка Pro через monobank", () => {
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>, orgId: string, paymentId: string, invoiceId: string;
  beforeAll(async () => {
    const o = await signUp(t.app, "o@example.com"); owner = api(t.app, o.cookie);
    orgId = (await owner.post("/api/orgs", { name: "O" })).json().id;
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, { role: "admin" })).json().token;
    const s = await signUp(t.app, "s@example.com"); staff = api(t.app, s.cookie); await staff.post(`/api/invites/${inv}/accept`);
  });

  it("billing info: тарифи з ціною, free без терміну", async () => {
    const b = (await owner.get(`/api/orgs/${orgId}/billing`)).json();
    expect(b.enabled).toBe(true); expect(b.planId).toBe("free"); expect(b.planUntil).toBeNull();
    expect(b.plans.find((p: { id: string }) => p.id === "pro").priceMonth).toBe(60000);
    expect(b.months).toEqual([1, 3, 6, 12]);
    expect(b.options).toEqual([{ months: 1, amount: 60000, freeMonths: 0 }, { months: 3, amount: 180000, freeMonths: 0 }, { months: 6, amount: 300000, freeMonths: 1 }, { months: 12, amount: 600000, freeMonths: 2 }]);
  });

  it("checkout: лише owner, лише Pro, 3 міс = 1800 ₴, повертає pageUrl", async () => {
    expect((await staff.post(`/api/orgs/${orgId}/billing/checkout`, { months: 1 })).statusCode).toBe(403);
    expect((await owner.post(`/api/orgs/${orgId}/billing/checkout`, { planId: "max", months: 1 })).statusCode).toBe(400);
    expect((await owner.post(`/api/orgs/${orgId}/billing/checkout`, { months: 2 })).statusCode).toBe(400);
    const r = await owner.post(`/api/orgs/${orgId}/billing/checkout`, { months: 3 });
    expect(r.statusCode).toBe(200);
    expect(r.json().amount).toBe(180000);
    expect(r.json().pageUrl).toMatch(/^https:\/\/pay\.mbnk\.biz\//);
    paymentId = r.json().paymentId;
    const [p] = await t.db.select().from(payments).where(eq(payments.id, paymentId));
    invoiceId = p!.invoiceId!;
    expect(p!.status).toBe("created");
  });

  it("вебхук без підпису / з поганим підписом відхиляється", async () => {
    const body = JSON.stringify({ invoiceId, status: "success", amount: 180000 });
    expect((await t.app.inject({ method: "POST", url: "/api/billing/mono/webhook", headers: { "content-type": "application/json" }, payload: body })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/api/billing/mono/webhook", headers: { "content-type": "application/json", "x-sign": signBody(body + "x") }, payload: body })).statusCode).toBe(400);
    expect((await owner.get(`/api/orgs/${orgId}`)).json().plan.id).toBe("free");
  });

  it("вебхук success продовжує Pro на 3 місяці; повтор вебхука не подвоює", async () => {
    const body = JSON.stringify({ invoiceId, status: "success", amount: 180000, finalAmount: 180000, ccy: 980, reference: paymentId });
    const r = await t.app.inject({ method: "POST", url: "/api/billing/mono/webhook", headers: { "content-type": "application/json", "x-sign": signBody(body) }, payload: body });
    expect(r.statusCode).toBe(200);
    const b = (await owner.get(`/api/orgs/${orgId}/billing`)).json();
    expect(b.planId).toBe("pro");
    const until = Date.parse(b.planUntil);
    expect(until).toBeGreaterThan(Date.now() + 85 * 86400_000); expect(until).toBeLessThan(Date.now() + 95 * 86400_000);
    await t.app.inject({ method: "POST", url: "/api/billing/mono/webhook", headers: { "content-type": "application/json", "x-sign": signBody(body) }, payload: body });
    expect(Date.parse((await owner.get(`/api/orgs/${orgId}/billing`)).json().planUntil)).toBe(until);
    expect((await owner.get(`/api/orgs/${orgId}`)).json().plan.limits.radio).toBe(true);
  });

  it("друга оплата продовжує від кінця поточного терміну; опитування статусу теж застосовує", async () => {
    const before = Date.parse((await owner.get(`/api/orgs/${orgId}/billing`)).json().planUntil);
    const r = (await owner.post(`/api/orgs/${orgId}/billing/checkout`, { months: 1 })).json();
    const [p] = await t.db.select().from(payments).where(eq(payments.id, r.paymentId));
    invoices.set(p!.invoiceId!, { invoiceId: p!.invoiceId!, status: "success", amount: 60000, finalAmount: 60000, ccy: 980 });
    const refreshed = (await owner.get(`/api/orgs/${orgId}/billing/payments/${r.paymentId}`)).json();
    expect(refreshed.status).toBe("success");
    const after = Date.parse((await owner.get(`/api/orgs/${orgId}/billing`)).json().planUntil);
    expect(after - before).toBeGreaterThan(27 * 86400_000);
  });

  it("прострочення повертає free", async () => {
    await t.db.update(organizations).set({ planUntil: new Date(Date.now() - 1000) }).where(eq(organizations.id, orgId));
    expect(await expireSubscriptions(t.db)).toBe(1);
    expect((await owner.get(`/api/orgs/${orgId}`)).json().plan.id).toBe("free");
  });

  it("без токена monobank checkout повертає 409 billing_disabled", async () => {
    const t2 = await makeTestApp({ mono: null });
    const o = await signUp(t2.app, "z@example.com"); const own = api(t2.app, o.cookie);
    const org = (await own.post("/api/orgs", { name: "Z" })).json().id;
    const r = await own.post(`/api/orgs/${org}/billing/checkout`, { months: 1 });
    expect(r.statusCode).toBe(409); expect(r.json().error).toBe("billing_disabled");
    await t2.close();
  });
});
