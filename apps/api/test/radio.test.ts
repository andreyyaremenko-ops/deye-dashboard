import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { RADIO_STATIONS } from "@deye/shared";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";
import { organizations, plans } from "../src/db/schema.ts";
import { ProbeError, decodeHeader, firstStreamFromPlaylist, isPrivateIp, probeStream, type Lookup } from "../src/radio/probe.ts";

/** Підроблена мережа: адреса -> відповідь; DNS: хост -> IP. */
function net(routes: Record<string, () => Response>, dns: Record<string, string[]> = {}) {
  const seen: string[] = [];
  const fetchImpl = (async (u: URL | string) => {
    const key = String(u);
    seen.push(key);
    const r = routes[key];
    if (!r) throw new Error("ECONNREFUSED");
    return r();
  }) as typeof fetch;
  const lookup: Lookup = async (host) => dns[host] ?? ["93.184.216.34"];
  return { fetchImpl, lookup, seen };
}
const audio = (type = "audio/mpeg", headers: Record<string, string> = {}) => () => new Response("ID3....", { status: 200, headers: { "content-type": type, ...headers } });
const text = (body: string, type: string) => () => new Response(body, { status: 200, headers: { "content-type": type } });
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });

describe("перевірка радіостріму", () => {
  it("прямий mp3-стрім приймається, назва з icy-name", async () => {
    // як на дроті: UTF-8 байти в заголовку, який fetch читає як latin1
    const raw = Buffer.from("Кавове радіо", "utf8").toString("latin1");
    const n = net({ "https://radio.example/live": audio("audio/mpeg", { "icy-name": raw }) });
    await expect(probeStream("https://radio.example/live", n)).resolves.toEqual({ url: "https://radio.example/live", contentType: "audio/mpeg", name: "Кавове радіо" });
  });

  it("плейлисти .m3u і .pls розгортаються до стріму", async () => {
    const n = net({
      "https://radio.example/listen.m3u": text("#EXTM3U\n#EXTINF:-1,Radio\nhttps://cdn.radio.example/stream.aac\n", "audio/x-mpegurl"),
      "https://radio.example/listen.pls": text("[playlist]\nNumberOfEntries=1\nFile1=https://cdn.radio.example/stream.aac\n", "audio/x-scpls"),
      "https://cdn.radio.example/stream.aac": audio("audio/aac"),
    });
    expect((await probeStream("https://radio.example/listen.m3u", n)).url).toBe("https://cdn.radio.example/stream.aac");
    expect((await probeStream("https://radio.example/listen.pls", n)).url).toBe("https://cdn.radio.example/stream.aac");
  });

  it("типові помилки клієнта — зрозумілими словами", async () => {
    const n = net({
      "https://radio.example/": text("<html>…</html>", "text/html"),
      "https://radio.example/hls.m3u8": text("#EXTM3U\n#EXT-X-VERSION:3", "application/vnd.apple.mpegurl"),
      "https://radio.example/404": () => new Response("nope", { status: 404 }),
    });
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as ProbeError).code);
    expect(await code(probeStream("http://radio.example/live", n))).toBe("not_https");
    expect(await code(probeStream("https://radio.example/", n))).toBe("html");
    expect(await code(probeStream("https://radio.example/hls.m3u8", n))).toBe("hls");
    expect(await code(probeStream("https://radio.example/404", n))).toBe("http_status");
    expect(await code(probeStream("https://down.example/live", n))).toBe("unreachable");
    expect(await code(probeStream("не адреса", n))).toBe("bad_url");
  });

  it("SSRF: внутрішні адреси відхиляються, зокрема через редирект", async () => {
    const n = net({
      "https://evil.example/stream": redirect("https://postgres:5432/"),
      "https://sneaky.example/stream": redirect("https://127.0.0.1/admin"),
    }, { postgres: ["172.19.0.3"], "internal.example": ["10.0.0.5"] });
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e as ProbeError).code);
    expect(await code(probeStream("https://internal.example/live", n))).toBe("private");
    expect(await code(probeStream("https://evil.example/stream", n))).toBe("private");
    expect(await code(probeStream("https://sneaky.example/stream", n))).toBe("private");
    expect(await code(probeStream("https://[::1]/x", n))).toBe("private");
    // до внутрішнього сервісу запит так і не пішов
    expect(n.seen.some((u) => u.includes("postgres") || u.includes("127.0.0.1"))).toBe(false);
  });

  it("класифікація адрес і розбір плейлиста", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "0.0.0.0"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
    expect(firstStreamFromPlaylist("#EXTM3U\n\n https://a.example/s \n")).toBe("https://a.example/s");
    expect(firstStreamFromPlaylist("[playlist]\nTitle1=x")).toBeNull();
    expect(decodeHeader("Radio Relax")).toBe("Radio Relax");
    expect(decodeHeader("Caf\u00e9 FM")).toBe("Caf\u00e9 FM");     // справжній latin1 лишається як є
    expect(decodeHeader("  ")).toBeNull();
  });
});

describe("власні радіостанції закладу", () => {
  let t: TestApp;
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>, other: ReturnType<typeof api>;
  let orgId: string, otherOrg: string, stationId: string, stationUrl: string, screenId: string;

  // у тестах мережу замінює заглушка: адреса з "bad" — не аудіо, решта — робочий стрім
  const probe = async (url: string) => {
    if (url.includes("bad")) throw new ProbeError("html", "Це сторінка сайту, а не стрім");
    return { url: url.replace(".m3u", ".mp3"), contentType: "audio/mpeg", name: "Icy Name" };
  };

  beforeAll(async () => {
    t = await makeTestApp({ radioProbe: probe });
    const o = await signUp(t.app, "owner@radio.test"); owner = api(t.app, o.cookie);
    const s = await signUp(t.app, "staff@radio.test"); staff = api(t.app, s.cookie);
    const x = await signUp(t.app, "x@radio.test"); other = api(t.app, x.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Кавʼярня" })).json().id;
    otherOrg = (await other.post("/api/orgs", { name: "Інші" })).json().id;
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, {})).json();
    await staff.post(`/api/invites/${inv.token}/accept`);
    screenId = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "Зал" })).json().id;
  });
  afterAll(async () => { await t.close(); });

  it("owner додає станцію: плейлист розгорнуто, назва з icy-name", async () => {
    const r = await owner.post(`/api/orgs/${orgId}/radio`, { url: "https://my.radio/listen.m3u" });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ title: "Icy Name", url: "https://my.radio/listen.mp3", sourceUrl: "https://my.radio/listen.m3u" });
    stationId = r.json().id; stationUrl = r.json().url;

    const list = (await staff.get(`/api/orgs/${orgId}/radio`)).json();
    expect(list.catalog.length).toBe(RADIO_STATIONS.length);
    expect(list.own.map((s: { url: string }) => s.url)).toEqual([stationUrl]);
  });

  it("неробочий стрім, дубль і станція з каталогу відхиляються", async () => {
    const bad = await owner.post(`/api/orgs/${orgId}/radio`, { url: "https://bad.example/" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("radio_html");
    expect((await owner.post(`/api/orgs/${orgId}/radio`, { url: "https://my.radio/listen.mp3" })).json().error).toBe("radio_exists");
    expect((await owner.post(`/api/orgs/${orgId}/radio`, { url: RADIO_STATIONS[0]!.url })).json().error).toBe("radio_in_catalog");
  });

  it("staff і чужі не додають і не видаляють", async () => {
    expect((await staff.post(`/api/orgs/${orgId}/radio`, { url: "https://x.radio/s" })).statusCode).toBe(403);
    expect((await staff.del(`/api/orgs/${orgId}/radio/${stationId}`)).statusCode).toBe(403);
    expect((await other.get(`/api/orgs/${orgId}/radio`)).statusCode).toBe(403);
    expect((await other.del(`/api/orgs/${otherOrg}/radio/${stationId}`)).statusCode).toBe(404);
  });

  it("екран приймає свою станцію і каталог, але не довільну адресу й не чужу станцію", async () => {
    const cfg = (radioUrl: string) => ({ config: { backgroundId: null, radioUrl, theme: "dark", widgets: [] } });
    expect((await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, cfg(stationUrl))).statusCode).toBe(200);
    expect((await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, cfg(RADIO_STATIONS[1]!.url))).statusCode).toBe(200);
    const raw = await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, cfg("https://unchecked.example/stream"));
    expect(raw.statusCode).toBe(400);
    expect(raw.json().error).toBe("bad_radio");
    // станція іншої організації — теж ні
    const foreign = (await other.post(`/api/orgs/${otherOrg}/radio`, { url: "https://their.radio/s.mp3" })).json();
    const otherScreen = (await other.post(`/api/orgs/${otherOrg}/screens`, { name: "Їхній" })).json().id;
    expect((await other.patch(`/api/orgs/${otherOrg}/screens/${otherScreen}`, cfg(stationUrl))).json().error).toBe("bad_radio");
    expect((await other.patch(`/api/orgs/${otherOrg}/screens/${otherScreen}`, cfg(foreign.url))).statusCode).toBe(200);
  });

  it("станцію, що грає на екрані, не видалити; після зміни радіо — можна", async () => {
    await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: { backgroundId: null, radioUrl: stationUrl, theme: "dark", widgets: [] } });
    const busy = await owner.del(`/api/orgs/${orgId}/radio/${stationId}`);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().message).toContain("Зал");
    await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: { backgroundId: null, radioUrl: null, theme: "dark", widgets: [] } });
    expect((await owner.del(`/api/orgs/${orgId}/radio/${stationId}`)).statusCode).toBe(204);
  });

  it("ліміт тарифу на кількість станцій", async () => {
    await t.db.insert(plans).values({ id: "radio-1", name: "R1", priceMonth: null, limits: { screens: 1, devices: 1, custom_backgrounds: true, history_days: 30, radio: true, branding: true, menus: 1, ai_dishes: 0, ai_generations_month: 0, custom_radio: 1 } });
    await t.db.update(organizations).set({ planId: "radio-1" }).where(eq(organizations.id, orgId));
    expect((await owner.post(`/api/orgs/${orgId}/radio`, { url: "https://one.radio/s.mp3" })).statusCode).toBe(201);
    const over = await owner.post(`/api/orgs/${orgId}/radio`, { url: "https://two.radio/s.mp3" });
    expect(over.statusCode).toBe(409);
    expect(over.json().error).toBe("plan_limit");
  });
});

describe("звук для віджета спектра", () => {
  let t: TestApp;
  let owner: ReturnType<typeof api>;
  let orgId: string;
  const seen: string[] = [];

  // cors.example віддає Access-Control-Allow-Origin, plain.example — ні
  const radioFetch = (async (u: URL | string, init?: RequestInit) => {
    const url = String(u);
    seen.push(url);
    const headers: Record<string, string> = { "content-type": "audio/mpeg" };
    if (url.includes("cors.example")) headers["access-control-allow-origin"] = String((init?.headers as Record<string, string>)?.origin ?? "*");
    return new Response("ID3audio", { status: 200, headers });
  }) as typeof fetch;

  const screenWith = async (radioUrl: string | null, spectrum: boolean) => {
    const sc = (await owner.post(`/api/orgs/${orgId}/screens`, { name: `Екран ${Math.random()}` })).json();
    const widgets = spectrum ? [{ id: "v1", type: "spectrum", x: 2, y: 2, w: 30, h: 20, props: { mode: "bars" } }] : [];
    await owner.patch(`/api/orgs/${orgId}/screens/${sc.id}`, {
      config: { backgroundId: null, widgets: [], radioUrl, theme: "dark",
        scenes: [{ id: "main", name: "", durationS: 30, backgroundId: null, theme: "dark", schedule: null, onOutage: false, widgets }] },
    });
    return sc.viewToken as string;
  };
  const radioOf = async (token: string) => (await t.app.inject({ method: "GET", url: `/api/public/screens/${token}/radio` })).json();

  beforeAll(async () => {
    t = await makeTestApp({ radioFetch, radioProbe: async (url: string) => ({ url, contentType: "audio/mpeg", name: "St" }) });
    const o = await signUp(t.app, "owner@viz.test"); owner = api(t.app, o.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Бар" })).json().id;
    // Pro: радіо входить у тариф; екран приймає лише станцію з каталогу або власну
    await t.db.update(organizations).set({ planId: "pro" }).where(eq(organizations.id, orgId));
    for (const url of ["https://plain.example/live", "https://cors.example/live"]) {
      await owner.post(`/api/orgs/${orgId}/radio`, { title: url.includes("cors") ? "З CORS" : "Без CORS", url });
    }
  });
  afterAll(async () => { await t.close(); });

  it("без віджета спектра адреса лишається прямою і станцію не чіпаємо", async () => {
    seen.length = 0;
    const token = await screenWith("https://plain.example/live", false);
    expect(await radioOf(token)).toEqual({ url: "https://plain.example/live", proxied: false, analyser: false });
    expect(seen).toEqual([]);   // зайвого запиту до станції немає
  });

  it("станція з CORS грає напряму, аналізатор доступний", async () => {
    const token = await screenWith("https://cors.example/live", true);
    expect(await radioOf(token)).toEqual({ url: "https://cors.example/live", proxied: false, analyser: true });
  });

  it("станція без CORS іде через наш проксі", async () => {
    const token = await screenWith("https://plain.example/live", true);
    const r = await radioOf(token);
    expect(r).toEqual({ url: `/api/public/screens/${token}/radio/stream`, proxied: true, analyser: true });

    const stream = await t.app.inject({ method: "GET", url: r.url });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toBe("audio/mpeg");
    expect(stream.body).toBe("ID3audio");
    expect(seen).toContain("https://plain.example/live");
  });

  it("перевірка CORS кешується: друга видача не стукає в станцію", async () => {
    const token = await screenWith("https://cors.example/live", true);
    seen.length = 0;
    await radioOf(token);
    expect(seen.filter((u) => u.includes("cors.example"))).toEqual([]);
  });

  it("радіо вимкнене — нічого не віддаємо, проксі мовчить", async () => {
    const token = await screenWith(null, true);
    expect(await radioOf(token)).toEqual({ url: null, proxied: false, analyser: false });
    const stream = await t.app.inject({ method: "GET", url: `/api/public/screens/${token}/radio/stream` });
    expect(stream.statusCode).toBe(404);
  });
});
