import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";
import { backgrounds, organizations, transcodeJobs } from "../src/db/schema.ts";

let t: TestApp;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(async () => { await t.close(); });

function multipart(fields: { name: string; filename: string; type: string; data: string }) {
  const b = "----deyeBoundary";
  const body = `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${fields.filename}"\r\nContent-Type: ${fields.type}\r\n\r\n${fields.data}\r\n--${b}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${b}` }, payload: body };
}

describe("бібліотека фонів", () => {
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>, other: ReturnType<typeof api>;
  let orgId: string, otherOrg: string, stdId: string, ownId: string;

  beforeAll(async () => {
    const o = await signUp(t.app, "o@example.com"); owner = api(t.app, o.cookie);
    const x = await signUp(t.app, "x@example.com"); other = api(t.app, x.cookie);
    orgId = (await owner.post("/api/orgs", { name: "O" })).json().id;
    otherOrg = (await other.post("/api/orgs", { name: "X" })).json().id;
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, { role: "staff" })).json().token;
    const s = await signUp(t.app, "s@example.com"); staff = api(t.app, s.cookie); await staff.post(`/api/invites/${inv}/accept`);
    const [std] = await t.db.insert(backgrounds).values({ name: "Камін", category: "Вогонь", license: "Pexels License", status: "ready", files: { "1080": "bg/a-1080.mp4", "720": "bg/a-720.mp4" }, preview: "bg/a.jpg", attribution: "Someone / Pexels" }).returning();
    stdId = std!.id;
    await t.db.insert(backgrounds).values({ name: "Ще не готовий", category: "Вогонь", status: "processing" }); // стандартний, але не ready — не показується
  });

  it("staff бачить стандартні ready-фони, без чужих", async () => {
    const list = (await staff.get(`/api/orgs/${orgId}/backgrounds`)).json();
    expect(list.map((b: { id: string }) => b.id)).toEqual([stdId]);
    expect(list[0].attribution).toBe("Someone / Pexels");
  });

  it("free: завантаження власного відео відхиляється тарифом; staff — правами", async () => {
    const mp = multipart({ name: "file", filename: "cafe.mp4", type: "video/mp4", data: "fake" });
    expect((await t.app.inject({ method: "POST", url: `/api/orgs/${orgId}/backgrounds`, headers: { cookie: (await signUp(t.app, "tmp@example.com")).cookie, ...mp.headers }, payload: mp.payload })).statusCode).toBe(403);
    const r = await t.app.inject({ method: "POST", url: `/api/orgs/${orgId}/backgrounds`, headers: { cookie: ownerCookie(), ...mp.headers }, payload: mp.payload });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe("plan_limit");
  });

  it("pro: завантаження створює фон у статусі uploaded і джобу; не-відео відхиляється", async () => {
    await t.db.update(organizations).set({ planId: "pro" }).where(eq(organizations.id, orgId));
    const bad = multipart({ name: "file", filename: "x.png", type: "image/png", data: "png" });
    expect((await t.app.inject({ method: "POST", url: `/api/orgs/${orgId}/backgrounds`, headers: { cookie: ownerCookie(), ...bad.headers }, payload: bad.payload })).statusCode).toBe(400);
    const mp = multipart({ name: "file", filename: "cafe evening.mp4", type: "video/mp4", data: "fake-video-bytes" });
    const r = await t.app.inject({ method: "POST", url: `/api/orgs/${orgId}/backgrounds`, headers: { cookie: ownerCookie(), ...mp.headers }, payload: mp.payload });
    expect(r.statusCode).toBe(201);
    ownId = r.json().id;
    expect(r.json()).toMatchObject({ name: "cafe evening", status: "uploaded", orgId, category: "Мої" });
    expect(r.json().sourceFile).toMatch(/^uploads\/.+\.mp4$/);
    const jobs = await t.db.select().from(transcodeJobs).where(eq(transcodeJobs.backgroundId, ownId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("queued");
    const list = (await owner.get(`/api/orgs/${orgId}/backgrounds`)).json();
    expect(list.map((b: { id: string }) => b.id).sort()).toEqual([stdId, ownId].sort());
  });

  it("чужа організація не бачить і не видаляє власний фон; екран не може на нього посилатись", async () => {
    expect((await other.get(`/api/orgs/${otherOrg}/backgrounds`)).json().map((b: { id: string }) => b.id)).toEqual([stdId]);
    expect((await other.del(`/api/orgs/${otherOrg}/backgrounds/${ownId}`)).statusCode).toBe(404);
    const scr = await other.post(`/api/orgs/${otherOrg}/screens`, { name: "S", config: { backgroundId: ownId, widgets: [], radioUrl: null, theme: "dark" } });
    expect(scr.statusCode).toBe(400);
    expect((await other.post(`/api/orgs/${otherOrg}/screens`, { name: "S", config: { backgroundId: stdId, widgets: [], radioUrl: null, theme: "dark" } })).statusCode).toBe(201);
  });

  it("владелець видаляє власний фон разом із джобою", async () => {
    expect((await staff.del(`/api/orgs/${orgId}/backgrounds/${ownId}`)).statusCode).toBe(403);
    expect((await owner.del(`/api/orgs/${orgId}/backgrounds/${ownId}`)).statusCode).toBe(204);
    expect(await t.db.select().from(transcodeJobs).where(eq(transcodeJobs.backgroundId, ownId))).toHaveLength(0);
  });

  const cookies: Record<string, string> = {};
  function ownerCookie() { return cookies.owner!; }
  beforeAll(async () => { cookies.owner = (await signUp(t.app, "owner2@example.com")).cookie; const o2 = api(t.app, cookies.owner); const inv = (await owner.post(`/api/orgs/${orgId}/invites`, { role: "owner" })).json().token; await o2.post(`/api/invites/${inv}/accept`); });
});
