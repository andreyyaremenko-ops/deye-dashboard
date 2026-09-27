import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";
import { NvrError, type NvrClient } from "../src/nvr/client.ts";
import { camerasOf } from "../src/nvr/service.ts";
import { screenConfigSchema } from "@deye/shared";

/** Заглушка NVR: правильний ключ приймається, решта — помилка автентифікації, як у справжнього. */
const client: NvrClient = {
  async listCameras(baseUrl, token) {
    if (token !== "good-key-123") throw new NvrError("NVR не прийняв ключ", "auth");
    if (baseUrl.includes("down")) throw new NvrError("NVR не відповідає", "unreachable");
    return [{ id: "cam001", online: true, substream: true }, { id: "cam002", online: false, substream: true }];
  },
  async liveUrl(baseUrl, token, camera) {
    if (camera === "cam002") throw new NvrError("NVR не знає такої камери", "not_found");
    return { camera, quality: "sub", hlsUrl: `https://nvr.example/s/4.1.${camera}.sig/hls/${camera}sub/index.m3u8?q=1`, expiresAt: new Date(Date.now() + 86400_000).toISOString() };
  },
};

const withCamera = (cameras: string[]) => ({
  backgroundId: null, widgets: [], radioUrl: null, theme: "dark" as const,
  scenes: [{ id: "main", name: "", durationS: 30, backgroundId: null, theme: "dark" as const, schedule: null, onOutage: false,
    widgets: [{ id: "c1", type: "camera" as const, x: 2, y: 2, w: 40, h: 30, props: { cameras } }] }],
});

describe("камери закладу (NVR)", () => {
  let t: TestApp;
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>, other: ReturnType<typeof api>;
  let orgId: string, screenId: string, viewToken: string;

  beforeAll(async () => {
    t = await makeTestApp({ nvr: client });
    const o = await signUp(t.app, "owner@nvr.test"); owner = api(t.app, o.cookie);
    const s = await signUp(t.app, "staff@nvr.test"); staff = api(t.app, s.cookie);
    const x = await signUp(t.app, "x@nvr.test"); other = api(t.app, x.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Магазин" })).json().id;
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, {})).json();
    await staff.post(`/api/invites/${inv.token}/accept`);
    const sc = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "Зал" })).json();
    screenId = sc.id; viewToken = sc.viewToken;
  });
  afterAll(async () => { await t.close(); });

  it("ключ перевіряється при збереженні і назад не віддається", async () => {
    const bad = await owner.put(`/api/orgs/${orgId}/nvr`, { baseUrl: "https://nvr.example", token: "wrong-key-1" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("nvr_auth");

    const ok = await owner.put(`/api/orgs/${orgId}/nvr`, { baseUrl: "https://nvr.example/api/v1/", token: "good-key-123" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ baseUrl: "https://nvr.example", cameras: 2, online: 1 });   // шлях з адреси прибрано

    const got = (await owner.get(`/api/orgs/${orgId}/nvr`)).json();
    expect(got.baseUrl).toBe("https://nvr.example");
    expect(got.tokenHint).toBe("…ey-123");
    expect(JSON.stringify(got)).not.toContain("good-key-123");
  });

  it("персонал не редагує налаштування, чужа організація не бачить камер", async () => {
    expect((await staff.put(`/api/orgs/${orgId}/nvr`, { baseUrl: "https://nvr.example", token: "good-key-123" })).statusCode).toBe(403);
    expect((await staff.del(`/api/orgs/${orgId}/nvr`)).statusCode).toBe(403);
    expect((await other.get(`/api/orgs/${orgId}/nvr/cameras`)).statusCode).toBe(403);
  });

  it("список камер для редактора", async () => {
    const r = await owner.get(`/api/orgs/${orgId}/nvr/cameras`);
    expect(r.json().cameras).toEqual([{ id: "cam001", online: true, substream: true }, { id: "cam002", online: false, substream: true }]);
  });

  it("екран отримує посилання на наш проксі, а не на NVR", async () => {
    await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: withCamera(["cam001", "cam002"]) });
    const r = await t.app.inject({ method: "GET", url: `/api/public/screens/${viewToken}/cameras` });
    expect(r.statusCode).toBe(200);
    const [c1, c2] = r.json().cameras;
    expect(c1.id).toBe("cam001");
    expect(c1.hlsUrl).toBe(`/api/public/screens/${viewToken}/nvr/s/4.1.cam001.sig/hls/cam001sub/index.m3u8?q=1`);
    expect(JSON.stringify(r.json())).not.toContain("nvr.example");   // домен NVR на телевізор не потрапляє
    // камера, яку NVR не віддав, не ламає решту
    expect(c2).toMatchObject({ id: "cam002", hlsUrl: null });
    expect(c2.error).toContain("камери");
  });

  it("проксі пускає лише підписані стрім-адреси NVR", async () => {
    const bad = await t.app.inject({ method: "GET", url: `/api/public/screens/${viewToken}/nvr/api/v1/cameras` });
    expect(bad.statusCode).toBe(403);
  });

  it("проксі несе шлях і запит у NVR, редирект повертає на наш префікс", async () => {
    const seen: string[] = [];
    const nvrFetch = (async (u: URL | string) => {
      seen.push(String(u));
      return new Response(null, { status: 302, headers: { location: "https://nvr.example/s/4.1.cam001.sig/hls/cam001sub/index.m3u8?cookieCheck=1", "set-cookie": "cookieCheck=1; Path=/" } });
    }) as typeof fetch;
    const t2 = await makeTestApp({ nvr: client, nvrFetch });
    try {
      const u = await signUp(t2.app, "o2@nvr.test"); const a = api(t2.app, u.cookie);
      const org2 = (await a.post("/api/orgs", { name: "Другий" })).json().id;
      await a.put(`/api/orgs/${org2}/nvr`, { baseUrl: "https://nvr.example", token: "good-key-123" });
      const sc = (await a.post(`/api/orgs/${org2}/screens`, { name: "Зал" })).json();
      await a.patch(`/api/orgs/${org2}/screens/${sc.id}`, { config: withCamera(["cam001"]) });

      const r = await t2.app.inject({ method: "GET", url: `/api/public/screens/${sc.viewToken}/nvr/s/4.1.cam001.sig/hls/cam001sub/index.m3u8?q=1` });
      expect(seen).toEqual(["https://nvr.example/s/4.1.cam001.sig/hls/cam001sub/index.m3u8?q=1"]);
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toBe(`/api/public/screens/${sc.viewToken}/nvr/s/4.1.cam001.sig/hls/cam001sub/index.m3u8?cookieCheck=1`);
    } finally { await t2.close(); }
  });

  it("без налаштованого NVR екран отримує зрозумілу помилку", async () => {
    const t3 = await makeTestApp({ nvr: client });
    try {
      const u = await signUp(t3.app, "o3@nvr.test"); const a = api(t3.app, u.cookie);
      const org3 = (await a.post("/api/orgs", { name: "Третій" })).json().id;
      const sc = (await a.post(`/api/orgs/${org3}/screens`, { name: "Зал" })).json();
      await a.patch(`/api/orgs/${org3}/screens/${sc.id}`, { config: withCamera(["cam001"]) });
      const r = await t3.app.inject({ method: "GET", url: `/api/public/screens/${sc.viewToken}/cameras` });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("nvr_missing");
      expect((await a.get(`/api/orgs/${org3}/nvr`)).json()).toBeNull();
    } finally { await t3.close(); }
  });

  it("більше восьми камер в одному віджеті не зберігається", async () => {
    const many = Array.from({ length: 9 }, (_, i) => `cam${i}`);
    const r = await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: withCamera(many) });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("too_many_cameras");
  });

  it("camerasOf збирає камери з усіх сцен без повторів", () => {
    const cfg = screenConfigSchema.parse({
      backgroundId: null, widgets: [], radioUrl: null,
      scenes: [
        { id: "a", widgets: [{ id: "1", type: "camera", x: 0, y: 0, w: 10, h: 10, props: { cameras: ["cam1", "cam2"] } }] },
        { id: "b", widgets: [{ id: "2", type: "camera", x: 0, y: 0, w: 10, h: 10, props: { cameras: ["cam2", "cam3"] } },
                             { id: "3", type: "clock", x: 0, y: 0, w: 10, h: 10, props: {} }] },
      ],
    });
    expect(camerasOf(cfg)).toEqual(["cam1", "cam2", "cam3"]);
  });
});
