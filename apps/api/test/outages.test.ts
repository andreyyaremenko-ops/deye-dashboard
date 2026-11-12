/**
 * Графіки відключень з outage-data-ua: розбір реального знімка Київської області (12–13.11.2026),
 * київський час з урахуванням літнього/зимового, кеш на вимогу і публічний маршрут.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { makeTestApp, type TestApp } from "./helpers.ts";
import { FeedHub } from "../src/feeds/hub.ts";
import { kyivToEpoch, parseOutages } from "../src/feeds/outages.ts";
import { outageStatus } from "@deye/shared/outages";

const RAW = JSON.parse(readFileSync(new URL("./fixtures/outages-kyiv-region.json", import.meta.url), "utf8"));

describe("розбір outage-data-ua", () => {
  const feed = parseOutages(RAW, "kyiv-region", new Date("2026-11-12T19:00:00Z"));

  it("два дні, 12 підчерг, по 48 півгодин", () => {
    expect(feed.days.map((d) => d.date)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(Object.keys(feed.days[0]!.groups)).toHaveLength(12);
    for (const d of feed.days) for (const s of Object.values(d.groups)) expect(s).toMatch(/^[012]{48}$/);
  });

  it("години ДТЕК переходять у півгодини: no -> 11, yes -> 00, first -> 10", () => {
    // 12.11, черга 1.1: 00–04 немає, 04–10 є, 10–14 немає, 14:00–14:30 немає (first), далі є до 20:00
    const s = feed.days[0]!.groups["1.1"]!;
    expect(s.slice(0, 8)).toBe("11111111");
    expect(s.slice(8, 20)).toBe("000000000000");
    expect(s.slice(28, 30)).toBe("10");
  });

  it("день починається з київської півночі, оновлення ДТЕК — київський час", () => {
    expect(new Date(feed.days[0]!.start).toISOString()).toBe("2026-11-11T22:00:00.000Z");
    expect(feed.sourceUpdatedAt).toBe("2026-11-12T18:47:00.000Z");     // «12.11.2026 20:47», зима UTC+2
  });

  it("київський час влітку UTC+3, взимку UTC+2", () => {
    expect(new Date(kyivToEpoch(2026, 7, 1, 12, 0)).toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(new Date(kyivToEpoch(2026, 1, 15, 12, 0)).toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("поточний стан і наступна зміна за графіком", () => {
    const at = (iso: string) => Date.parse(iso);
    // 12.11 о 03:00 Києва черга 1.1 без світла, увімкнуть о 04:00
    const night = outageStatus(feed, "1.1", at("2026-11-12T01:00:00Z"));
    expect(night).toEqual({ state: "off", nextAt: at("2026-11-12T02:00:00Z"), nextState: "on" });
    // о 14:10 ще без світла (first), о 14:30 вмикають
    expect(outageStatus(feed, "1.1", at("2026-11-12T12:10:00Z"))?.nextAt).toBe(at("2026-11-12T12:30:00Z"));
    // о 22:00 12.11 світла немає до 02:30 13.11 (02–03 там «first»): зміна переходить через північ
    expect(outageStatus(feed, "1.1", at("2026-11-12T20:00:00Z"))).toEqual({ state: "off", nextAt: at("2026-11-13T00:30:00Z"), nextState: "on" });
    // поза відомими днями графіка немає
    expect(outageStatus(feed, "1.1", at("2026-11-15T10:00:00Z"))).toBeNull();
    expect(outageStatus(feed, "9.9", at("2026-11-12T10:00:00Z"))).toBeNull();
  });

  it("битий файл не стає порожнім графіком", () => {
    expect(() => parseOutages({}, "kyiv")).toThrow();
    expect(() => parseOutages({ fact: { data: {} } }, "kyiv")).toThrow();
  });
});

describe("кеш і маршрут /api/public/outages/:region", () => {
  let calls = 0, fail = false;
  const fakeFetch = (async () => {
    calls++;
    if (fail) return new Response("down", { status: 502 });
    return new Response(JSON.stringify(RAW), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  let t: TestApp;
  afterAll(async () => { await t?.close(); });

  it("один запит до джерела на регіон, потім кеш; джерело впало — віддаємо останній відомий графік", async () => {
    let hub!: FeedHub;
    t = await makeTestApp({ feeds: (store, db) => { hub = new FeedHub({ db, store, log: { info() {}, warn() {} }, fetchImpl: fakeFetch }); return hub; } });
    const r1 = await t.app.inject({ method: "GET", url: "/api/public/outages/kyiv-region" });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().days).toHaveLength(2);
    await t.app.inject({ method: "GET", url: "/api/public/outages/kyiv-region" });
    expect(calls).toBe(1);

    // кеш протух (fetchedAt давно), а джерело лежить — відповідь та сама, а не 503
    const stale = { ...r1.json(), fetchedAt: "2020-01-01T00:00:00.000Z" };
    await t.store.setFeed("outages:kyiv-region", stale, 3600);
    fail = true;
    const r2 = await t.app.inject({ method: "GET", url: "/api/public/outages/kyiv-region" });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().days).toHaveLength(2);
    expect(calls).toBe(2);
  });

  it("невідомий регіон — 400, нема даних зовсім — 503", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/public/outages/lviv" })).statusCode).toBe(400);
    expect((await t.app.inject({ method: "GET", url: "/api/public/outages/odesa" })).statusCode).toBe(503);
  });
});
