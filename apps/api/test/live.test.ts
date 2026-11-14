import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestApp, signUp, api, INTERNAL, type TestApp } from "./helpers.ts";

describe("прямі трансляції", () => {
  let t: TestApp;
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>, other: ReturnType<typeof api>;
  let orgId: string;
  let stream: { id: string; pathId: string; publishKey: string; whipUrl: string; hlsUrl: string };

  /** Запит MediaMTX на authHTTPAddress (з docker-мережі або ззовні). */
  const auth = (body: Record<string, unknown>, remoteAddress = "172.19.0.9") =>
    t.app.inject({ method: "POST", url: "/internal/mediamtx/auth", payload: body, remoteAddress }).then((r) => r.statusCode);

  beforeAll(async () => {
    t = await makeTestApp();
    const o = await signUp(t.app, "owner@live.test"); owner = api(t.app, o.cookie);
    const s = await signUp(t.app, "staff@live.test"); staff = api(t.app, s.cookie);
    const x = await signUp(t.app, "x@live.test"); other = api(t.app, x.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Кавʼярня" })).json().id;
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, {})).json();
    await staff.post(`/api/invites/${inv.token}/accept`);
  });
  afterAll(async () => { await t.close(); });

  it("адмін створює трансляцію, персонал бачить її з ключем, чужі — ні", async () => {
    const r = await owner.post(`/api/orgs/${orgId}/live`, { name: "Зал" });
    expect(r.statusCode).toBe(201);
    stream = r.json();
    expect(stream.pathId).toMatch(/^[a-z0-9]{16}$/);
    expect(stream.whipUrl).toBe(`/live/whip/${stream.pathId}/whip`);
    expect(stream.hlsUrl).toBe(`/live/hls/${stream.pathId}/tv/index.m3u8`);

    expect((await staff.post(`/api/orgs/${orgId}/live`, { name: "Ще" })).statusCode).toBe(403);
    const seen = (await staff.get(`/api/orgs/${orgId}/live`)).json();
    expect(seen.map((x: { publishKey: string }) => x.publishKey)).toEqual([stream.publishKey]);
    expect((await other.get(`/api/orgs/${orgId}/live`)).statusCode).toBe(403);
    expect((await other.del(`/api/orgs/${orgId}/live/${stream.id}`)).statusCode).toBe(403);
  });

  it("браузер публікує лише по WebRTC і з ключем", async () => {
    const pub = { action: "publish", path: stream.pathId, protocol: "webrtc" };
    expect(await auth({ ...pub, token: stream.publishKey })).toBe(200);
    expect(await auth({ ...pub, user: "x", password: stream.publishKey })).toBe(200);   // ключ паролем — теж
    expect(await auth({ ...pub, token: "wrong" })).toBe(401);
    expect(await auth(pub)).toBe(401);
    expect(await auth({ ...pub, protocol: "rtmp", token: stream.publishKey })).toBe(401);
    expect(await auth({ ...pub, path: `${stream.pathId}/tv`, token: stream.publishKey })).toBe(401);   // версію для ТБ публікує лише ffmpeg
    expect(await auth({ ...pub, path: "aaaaaaaaaaaaaaaa", token: stream.publishKey })).toBe(401);
  });

  it("екран читає лише версію для ТБ і лише по HLS", async () => {
    expect(await auth({ action: "read", path: `${stream.pathId}/tv`, protocol: "hls" })).toBe(200);
    expect(await auth({ action: "read", path: stream.pathId, protocol: "hls" })).toBe(401);
    expect(await auth({ action: "read", path: `${stream.pathId}/tv`, protocol: "webrtc" })).toBe(401);
    expect(await auth({ action: "api", path: "", protocol: "" })).toBe(401);
  });

  it("ffmpeg усередині MediaMTX: лише localhost, внутрішній пароль і RTSP", async () => {
    const ff = { user: "mtx", password: INTERNAL.livePass, ip: "127.0.0.1", protocol: "rtsp" };
    expect(await auth({ ...ff, action: "read", path: stream.pathId })).toBe(200);
    expect(await auth({ ...ff, action: "publish", path: `${stream.pathId}/tv` })).toBe(200);
    expect(await auth({ ...ff, action: "publish", path: stream.pathId })).toBe(401);
    expect(await auth({ ...ff, ip: "203.0.113.5", action: "read", path: stream.pathId })).toBe(401);
    expect(await auth({ ...ff, password: "nope", action: "read", path: stream.pathId })).toBe(401);
  });

  it("хук не відповідає ззовні docker-мережі", async () => {
    expect(await auth({ action: "read", path: `${stream.pathId}/tv`, protocol: "hls" }, "8.8.8.8")).toBe(403);
  });

  it("новий ключ відрізає старий; видалена трансляція не пускає нікого", async () => {
    const fresh = (await owner.post(`/api/orgs/${orgId}/live/${stream.id}/rotate-key`)).json();
    expect(fresh.publishKey).not.toBe(stream.publishKey);
    expect(fresh.pathId).toBe(stream.pathId);
    const pub = { action: "publish", path: stream.pathId, protocol: "webrtc" };
    expect(await auth({ ...pub, token: stream.publishKey })).toBe(401);
    expect(await auth({ ...pub, token: fresh.publishKey })).toBe(200);

    expect((await owner.del(`/api/orgs/${orgId}/live/${stream.id}`)).statusCode).toBe(204);
    expect(await auth({ ...pub, token: fresh.publishKey })).toBe(401);
    expect(await auth({ action: "read", path: `${stream.pathId}/tv`, protocol: "hls" })).toBe(401);
  });
});
