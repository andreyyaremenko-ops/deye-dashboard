import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";
import { describeUa } from "../src/admin/service.ts";

let t: TestApp; let base = "";
beforeAll(async () => { t = await makeTestApp(); await t.app.listen({ port: 0, host: "127.0.0.1" }); base = `127.0.0.1:${(t.app.server.address() as { port: number }).port}`; });
afterAll(async () => { await t.close(); });

const open = (url: string) => new Promise<WebSocket>((res, rej) => { const ws = new WebSocket(url); ws.onopen = () => res(ws); ws.onerror = () => rej(new Error("ws error")); });
const closed = (ws: WebSocket) => new Promise<void>((res) => { ws.onclose = () => res(); ws.close(); });
const tick = () => new Promise((r) => setTimeout(r, 150));

describe("облік підключених телевізорів", () => {
  it("список екранів показує кількість глядачів і час останнього перегляду; адмін бачить пристрій", async () => {
    const o = await signUp(t.app, "o@example.com"); const owner = api(t.app, o.cookie);
    const orgId = (await owner.post("/api/orgs", { name: "O" })).json().id;
    const s = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "Зал" })).json();
    let list = (await owner.get(`/api/orgs/${orgId}/screens`)).json();
    expect(list[0].viewers).toBe(0); expect(list[0].lastViewedAt).toBeNull();

    const ws1 = await open(`ws://${base}/ws?token=${s.viewToken}`);
    const ws2 = await open(`ws://${base}/ws?token=${s.viewToken}`);
    await tick();
    list = (await owner.get(`/api/orgs/${orgId}/screens`)).json();
    expect(list[0].viewers).toBe(2); expect(list[0].lastViewedAt).not.toBeNull();
    expect(list[0].tvs).toHaveLength(2); expect(list[0].tvs[0].ip).toBe("127.0.0.1");

    await closed(ws1); await tick();
    expect((await owner.get(`/api/orgs/${orgId}/screens`)).json()[0].viewers).toBe(1);

    // адмін
    const a = await signUp(t.app, "admin@example.com");
    const { makeSuperadmin } = await import("./helpers.ts"); await makeSuperadmin(t, a.userId);
    const adm = (await api(t.app, a.cookie).get("/api/admin/screens")).json();
    expect(adm).toHaveLength(1); expect(adm[0].orgName).toBe("O"); expect(adm[0].viewers).toBe(1); expect(adm[0].tvs[0].device).toBeTruthy();
    await closed(ws2); await tick();
    expect((await api(t.app, a.cookie).get("/api/admin/screens")).json()[0].viewers).toBe(0);
  });
  it("describeUa", () => {
    expect(describeUa("Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36")).toBe("Samsung (Tizen)");
    expect(describeUa("Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36")).toBe("LG (webOS)");
    expect(describeUa("Mozilla/5.0 (Linux; Android 11; BRAVIA 4K VH2)")).toBe("Android TV");
    expect(describeUa("")).toBe("?");
  });
});
