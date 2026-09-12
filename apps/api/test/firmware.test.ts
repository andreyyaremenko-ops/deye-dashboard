import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestApp, signUp, api, makeSuperadmin, type TestApp } from "./helpers.ts";

let t: TestApp;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(async () => { await t.close(); });

function fwUpload(fields: Record<string, string>, bytes: number) {
  const b = "----deyeFw";
  let body = "";
  for (const [k, v] of Object.entries(fields)) body += `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  body += `--${b}\r\nContent-Disposition: form-data; name="file"; filename="fw.bin.signed"\r\nContent-Type: application/octet-stream\r\n\r\n${"x".repeat(bytes)}\r\n--${b}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${b}` }, payload: body };
}

describe("самореєстрація пристрою і OTA", () => {
  let admin: ReturnType<typeof api>, adminCookie: string;
  beforeAll(async () => { const a = await signUp(t.app, "admin@example.com"); await makeSuperadmin(t, a.userId); admin = api(t.app, a.cookie); adminCookie = a.cookie; });

  it("пристрій реєструє себе сам; повтор того ж id — 409; поганий hw — 409", async () => {
    const reg = (b: object) => t.app.inject({ method: "POST", url: "/api/devices/register", payload: b });
    const secret = "s".repeat(32);
    expect((await reg({ id: "aabbccddeeff", secret, claimCode: "ABCD2345", hw: "esp8266", fw: "0.2.0" })).statusCode).toBe(201);
    expect((await reg({ id: "aabbccddeeff", secret, claimCode: "ABCD2346", hw: "esp8266" })).statusCode).toBe(409);
    expect((await reg({ id: "aabbccddee00", secret, claimCode: "ABCD2347", hw: "arduino" })).statusCode).toBe(409);
    expect((await reg({ id: "aabbccddee00", secret: "short", claimCode: "ABCD2347", hw: "esp8266" })).statusCode).toBe(400);
    // секрет працює для MQTT, код — для claim
    expect((await t.app.inject({ method: "POST", url: "/internal/mqtt/auth", payload: { username: "aabbccddeeff", password: secret } })).statusCode).toBe(200);
    const o = await signUp(t.app, "o@example.com"); const owner = api(t.app, o.cookie);
    const orgId = (await owner.post("/api/orgs", { name: "O" })).json().id;
    expect((await owner.post(`/api/orgs/${orgId}/devices/claim`, { code: "abcd-2345" })).statusCode).toBe(201);
    const list = (await owner.get(`/api/orgs/${orgId}/devices`)).json();
    expect(list[0]).toMatchObject({ id: "aabbccddeeff", hw: "esp8266", fw: "0.2.0" });
    expect((await owner.patch(`/api/orgs/${orgId}/devices/aabbccddeeff/channel`, { channel: "beta" })).statusCode).toBe(200);
  });

  it("rate-limit на реєстрації", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await t.app.inject({ method: "POST", url: "/api/devices/register", payload: { id: `00000000000${i}`, secret: "s".repeat(32), claimCode: `CODE000${i}`, hw: "esp8266" } })).statusCode;
    expect(last).toBe(429);
  });

  it("прошивки: superadmin завантажує, latest віддає по каналу, beta бачить новіше", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/firmware/latest?hw=esp8266" })).statusCode).toBe(404);
    const up = (fields: Record<string, string>, bytes = 200_000) => t.app.inject({ method: "POST", url: "/api/admin/firmware", headers: { cookie: adminCookie, ...fwUpload(fields, bytes).headers }, payload: fwUpload(fields, bytes).payload });
    expect((await up({ hw: "esp8266", channel: "stable", version: "0.2.0" }, 100)).statusCode).toBe(400); // замалий
    const r = await up({ hw: "esp8266", channel: "stable", version: "0.2.0", notes: "TLS + OTA" });
    expect(r.statusCode).toBe(201);
    expect(r.json().sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json().file).toBe("firmware/esp8266-0.2.0-stable.bin.signed");
    expect((await up({ hw: "esp8266", channel: "stable", version: "0.2.0" })).statusCode).toBe(409);
    expect((await up({ hw: "esp8266", channel: "beta", version: "0.3.0-beta.1" })).statusCode).toBe(201);
    const stable = (await t.app.inject({ method: "GET", url: "/api/firmware/latest?hw=esp8266&channel=stable" })).json();
    expect(stable).toMatchObject({ version: "0.2.0", url: "/media/firmware/esp8266-0.2.0-stable.bin.signed", size: 200_000 });
    const beta = (await t.app.inject({ method: "GET", url: "/api/firmware/latest?hw=esp8266&channel=beta" })).json();
    expect(beta.version).toBe("0.3.0-beta.1");
    expect((await t.app.inject({ method: "GET", url: "/api/firmware/latest?hw=esp32" })).statusCode).toBe(404);
    // не superadmin — 403
    const x = await signUp(t.app, "x@example.com");
    expect((await t.app.inject({ method: "POST", url: "/api/admin/firmware", headers: { cookie: x.cookie, ...fwUpload({ hw: "esp8266", channel: "stable", version: "9.9.9" }, 200_000).headers }, payload: fwUpload({ hw: "esp8266", channel: "stable", version: "9.9.9" }, 200_000).payload })).statusCode).toBe(403);
    expect((await admin.get("/api/admin/firmware")).json()).toHaveLength(2);
  });
});
