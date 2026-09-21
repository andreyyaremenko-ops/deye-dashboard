import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { desc, eq } from "drizzle-orm";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { aiJobs, aiUsage, dishImages, organizations, plans } from "../src/db/schema.ts";

// тариф із одним меню: перевіряємо саму перевірку ліміту
const ONE = { id: "one-menu", name: "One", priceMonth: null, limits: { screens: 1, devices: 1, custom_backgrounds: true, history_days: 30, radio: true, branding: true, menus: 1, ai_dishes: 5, ai_generations_month: 10 } };

let t: TestApp;
beforeAll(async () => { t = await makeTestApp(); });
afterAll(async () => { await t.close(); });

describe("меню: CRUD, права, ліміти тарифу", () => {
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>, outsider: ReturnType<typeof api>;
  let orgId: string, otherOrg: string, menuId: string, sectionId: string, itemId: string;

  beforeAll(async () => {
    const o = await signUp(t.app, "owner@menu.test"); owner = api(t.app, o.cookie);
    const s = await signUp(t.app, "staff@menu.test"); staff = api(t.app, s.cookie);
    const x = await signUp(t.app, "x@menu.test"); outsider = api(t.app, x.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Кафе" })).json().id;
    otherOrg = (await outsider.post("/api/orgs", { name: "Чужі" })).json().id;
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, {})).json();
    await staff.post(`/api/invites/${inv.token}/accept`);
    await t.db.update(organizations).set({ planId: "max" }).where(eq(organizations.id, orgId));   // ліміт меню перевіряємо окремим тестом
  });

  it("owner створює меню, розділ і позицію; ціна з форми стає копійками", async () => {
    const m = await owner.post(`/api/orgs/${orgId}/menus`, { name: "Основне" });
    expect(m.statusCode).toBe(201);
    menuId = m.json().id;
    expect(m.json().status).toBe("draft");

    const sec = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/sections`, { name: "Кава" });
    expect(sec.statusCode).toBe(201);
    sectionId = sec.json().id;

    const it1 = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items`, { sectionId, name: "Лате", price: "70,50", volume: "0,25 л" });
    expect(it1.statusCode).toBe(201);
    itemId = it1.json().id;
    expect(it1.json().price).toBe(7050);
    expect(it1.json().inStock).toBe(true);

    const bad = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items`, { sectionId, name: "Лате", price: "дорого" });
    expect(bad.statusCode).toBe(400);
    // позиція в чужий розділ не потрапить
    const foreignSection = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items`, { sectionId: menuId, name: "X" });
    expect(foreignSection.statusCode).toBe(400);
  });

  it("порожнє меню не публікується, з позицією — публікується", async () => {
    const empty = await owner.post(`/api/orgs/${orgId}/menus`, { name: "Порожнє" });
    expect(empty.statusCode).toBe(201);
    const emptyPub = await owner.post(`/api/orgs/${orgId}/menus/${empty.json().id}/publish`);
    expect(emptyPub.statusCode).toBe(400);
    expect(emptyPub.json().error).toBe("empty_menu");
    await owner.del(`/api/orgs/${orgId}/menus/${empty.json().id}`);
    const pub = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/publish`);
    expect(pub.statusCode).toBe(200);
    expect(pub.json().status).toBe("published");
    expect(pub.json().publishedAt).toBeTruthy();
  });

  it("staff читає меню й міняє наявність, але не редагує", async () => {
    expect((await staff.get(`/api/orgs/${orgId}/menus`)).statusCode).toBe(200);
    const tree = await staff.get(`/api/orgs/${orgId}/menus/${menuId}`);
    expect(tree.statusCode).toBe(200);
    expect(tree.json().sections[0].items[0].name).toBe("Лате");

    const stock = await staff.patch(`/api/orgs/${orgId}/menus/${menuId}/items/${itemId}/stock`, { inStock: false });
    expect(stock.statusCode).toBe(200);
    expect(stock.json().inStock).toBe(false);
    await staff.patch(`/api/orgs/${orgId}/menus/${menuId}/items/${itemId}/stock`, { inStock: true });

    expect((await staff.patch(`/api/orgs/${orgId}/menus/${menuId}/items/${itemId}`, { name: "Капучино" })).statusCode).toBe(403);
    expect((await staff.post(`/api/orgs/${orgId}/menus/${menuId}/sections`, { name: "Десерти" })).statusCode).toBe(403);
    expect((await staff.post(`/api/orgs/${orgId}/menus`, { name: "Своє" })).statusCode).toBe(403);
    expect((await staff.del(`/api/orgs/${orgId}/menus/${menuId}`)).statusCode).toBe(403);
  });

  it("чужа організація не бачить і не чіпає меню", async () => {
    expect((await outsider.get(`/api/orgs/${orgId}/menus`)).statusCode).toBe(403);
    expect((await outsider.get(`/api/orgs/${orgId}/menus/${menuId}`)).statusCode).toBe(403);
    expect((await outsider.patch(`/api/orgs/${orgId}/menus/${menuId}/items/${itemId}/stock`, { inStock: false })).statusCode).toBe(403);
    // меню чужої організації через свій orgId — 404, а не чужі дані
    expect((await outsider.get(`/api/orgs/${otherOrg}/menus/${menuId}`)).statusCode).toBe(404);
    expect((await outsider.post(`/api/orgs/${otherOrg}/menus/${menuId}/publish`)).statusCode).toBe(404);
  });

  it("перенесення позиції між розділами і ручне правлення скидає confidence", async () => {
    const sec2 = (await owner.post(`/api/orgs/${orgId}/menus/${menuId}/sections`, { name: "Десерти" })).json();
    const moved = await owner.patch(`/api/orgs/${orgId}/menus/${menuId}/items/${itemId}`, { sectionId: sec2.id, name: "Лате великий", price: 8000 });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().sectionId).toBe(sec2.id);
    expect(moved.json().price).toBe(8000);
    expect(moved.json().confidence).toBeNull();
    // назад у каву
    await owner.patch(`/api/orgs/${orgId}/menus/${menuId}/items/${itemId}`, { sectionId });
  });

  it("стиль закладу: стандартний до збереження, потім власний", async () => {
    const def = await owner.get(`/api/orgs/${orgId}/menu-style`);
    expect(def.statusCode).toBe(200);
    expect(def.json().id).toBeNull();
    const saved = await owner.put(`/api/orgs/${orgId}/menu-style`, { prompt: "Темний дерев'яний стіл, вечірнє світло, крафтова подача" });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().id).toBeTruthy();
    expect((await owner.get(`/api/orgs/${orgId}/menu-style`)).json().prompt).toContain("Темний");
    expect((await staff.put(`/api/orgs/${orgId}/menu-style`, { prompt: "Щось своє, довше за десять символів" })).statusCode).toBe(403);
    expect((await owner.put(`/api/orgs/${orgId}/menu-style`, { prompt: "коротко" })).statusCode).toBe(400);
  });

  it("ліміт тарифу на кількість меню", async () => {
    await t.db.insert(plans).values(ONE);
    await t.db.update(organizations).set({ planId: "one-menu" }).where(eq(organizations.id, orgId));
    const second = await owner.post(`/api/orgs/${orgId}/menus`, { name: "Друге" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("plan_limit");
  });
});

describe("меню на екрані", () => {
  let owner: ReturnType<typeof api>, other: ReturnType<typeof api>;
  let orgId: string, otherOrg: string, menuId: string, foreignMenuId: string, screenId: string, token: string;

  beforeAll(async () => {
    const o = await signUp(t.app, "screen@menu.test"); owner = api(t.app, o.cookie);
    const x = await signUp(t.app, "screen-x@menu.test"); other = api(t.app, x.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Кафе 2" })).json().id;
    otherOrg = (await other.post("/api/orgs", { name: "Чужі 2" })).json().id;
    await t.db.update(organizations).set({ planId: "max" }).where(eq(organizations.id, orgId));
    menuId = (await owner.post(`/api/orgs/${orgId}/menus`, { name: "Барна карта" })).json().id;
    foreignMenuId = (await other.post(`/api/orgs/${otherOrg}/menus`, { name: "Чуже" })).json().id;
    const sec = (await owner.post(`/api/orgs/${orgId}/menus/${menuId}/sections`, { name: "Напої" })).json();
    await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items`, { sectionId: sec.id, name: "Еспресо", price: "45" });
    await owner.post(`/api/orgs/${orgId}/menus/${menuId}/publish`);
  });

  const cfg = (mid: string) => ({
    backgroundId: null, radioUrl: null, theme: "dark",
    widgets: [{ id: "m1", type: "menu", x: 0, y: 0, w: 50, h: 80, props: { menuId: mid } }],
  });

  it("віджет на чуже меню відхиляється, на своє — приймається", async () => {
    const bad = await owner.post(`/api/orgs/${orgId}/screens`, { name: "Зал", config: cfg(foreignMenuId) });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("bad_menu");
    const ok = await owner.post(`/api/orgs/${orgId}/screens`, { name: "Зал", config: cfg(menuId) });
    expect(ok.statusCode).toBe(201);
    screenId = ok.json().id; token = ok.json().viewToken;
  });

  it("публічний екран віддає опубліковане меню з цінами", async () => {
    const pub = await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` });
    expect(pub.statusCode).toBe(200);
    const menu = pub.json().menus[menuId];
    expect(menu.name).toBe("Барна карта");
    expect(menu.sections[0].items[0]).toMatchObject({ name: "Еспресо", price: 4500, inStock: true, image: null, imageIsAi: false });
  });

  it("зміна ціни будить телевізор цього екрана", async () => {
    const itemId = (await owner.get(`/api/orgs/${orgId}/menus/${menuId}`)).json().sections[0].items[0].id;
    t.store.notified.length = 0;
    const res = await owner.patch(`/api/orgs/${orgId}/menus/${menuId}/items/${itemId}`, { price: "50" });
    expect(res.statusCode).toBe(200);
    expect(t.store.notified).toContain(screenId);
  });

  it("неопубліковане меню на ТБ не потрапляє", async () => {
    const draftId = (await owner.post(`/api/orgs/${orgId}/menus`, { name: "Чернетка" })).json().id;
    await owner.patch(`/api/orgs/${orgId}/screens/${screenId}`, { config: cfg(draftId) });
    const pub = await t.app.inject({ method: "GET", url: `/api/public/screens/${token}` });
    expect(pub.json().menus).toEqual({});
  });
});

/** Кілька фото + текстове поле в одному multipart-тілі. */
function multipartFiles(name: string, files: { filename: string; type: string; data: string }[]) {
  const b = "----deyeMenuBoundary";
  const parts = [`--${b}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n`];
  for (const f of files) {
    parts.push(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n${f.data}\r\n`);
  }
  return { headers: { "content-type": `multipart/form-data; boundary=${b}` }, payload: parts.join("") + `--${b}--\r\n` };
}

describe("розпізнавання фото меню", () => {
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>, ownerCookie: string, staffCookie: string;
  let orgId: string;

  beforeAll(async () => {
    const o = await signUp(t.app, "import@menu.test"); owner = api(t.app, o.cookie); ownerCookie = o.cookie;
    const s = await signUp(t.app, "import-staff@menu.test"); staff = api(t.app, s.cookie); staffCookie = s.cookie;
    orgId = (await owner.post("/api/orgs", { name: "Піцерія" })).json().id;
    await t.db.update(organizations).set({ planId: "max" }).where(eq(organizations.id, orgId));
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, {})).json();
    await staff.post(`/api/invites/${inv.token}/accept`);
  });

  const post = (cookie: string, mp: ReturnType<typeof multipartFiles>) =>
    t.app.inject({ method: "POST", url: `/api/orgs/${orgId}/menus/import`, headers: { cookie, ...mp.headers }, payload: mp.payload });

  it("фото стають чернеткою в стані importing і задачею в черзі", async () => {
    const mp = multipartFiles("Літнє меню", [
      { filename: "p1.jpg", type: "image/jpeg", data: "fake-jpeg-1" },
      { filename: "p2.png", type: "image/png", data: "fake-png-2" },
    ]);
    const res = await post(ownerCookie, mp);
    expect(res.statusCode).toBe(202);
    const { menuId, jobId } = res.json();
    expect(jobId).toBeTruthy();

    const st = await owner.get(`/api/orgs/${orgId}/menus/${menuId}/import`);
    expect(st.statusCode).toBe(200);
    expect(st.json().menu).toMatchObject({ name: "Літнє меню", status: "importing" });
    expect(st.json().job).toMatchObject({ id: jobId, status: "queued", attempts: 0 });

    const [job] = await t.db.select().from(aiJobs).where(eq(aiJobs.id, jobId));
    expect(job!.kind).toBe("menu_import");
    expect(job!.refId).toBe(menuId);
    const files = job!.payload.files as string[];
    expect(files).toHaveLength(2);
    for (const f of files) expect(existsSync(join(t.mediaRoot, f))).toBe(true);
  });

  it("не-фото відхиляється, staff не імпортує", async () => {
    const pdf = multipartFiles("PDF", [{ filename: "menu.pdf", type: "application/pdf", data: "%PDF" }]);
    const bad = await post(ownerCookie, pdf);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("bad_type");

    const ok = multipartFiles("Спроба", [{ filename: "p.jpg", type: "image/jpeg", data: "x" }]);
    expect((await post(staffCookie, ok)).statusCode).toBe(403);
  });
});

// тариф із крихітними AI-лімітами: 1 страва з AI-фото, 3 зображення на місяць
const TINY = { id: "tiny-ai", name: "Tiny", priceMonth: null, limits: { screens: 5, devices: 1, custom_backgrounds: true, history_days: 30, radio: true, branding: true, menus: 5, ai_dishes: 1, ai_generations_month: 6 } };

describe("фото страв: черга, вибір варіанта, ліміти тарифу", () => {
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>;
  let orgId: string, menuId: string, sectionId: string, itemA: string, itemB: string;

  beforeAll(async () => {
    await t.db.insert(plans).values(TINY);
    const o = await signUp(t.app, "photo@menu.test"); owner = api(t.app, o.cookie);
    const s = await signUp(t.app, "photo-staff@menu.test"); staff = api(t.app, s.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Бістро" })).json().id;
    await t.db.update(organizations).set({ planId: "tiny-ai" }).where(eq(organizations.id, orgId));
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, {})).json();
    await staff.post(`/api/invites/${inv.token}/accept`);
    menuId = (await owner.post(`/api/orgs/${orgId}/menus`, { name: "Обіди" })).json().id;
    sectionId = (await owner.post(`/api/orgs/${orgId}/menus/${menuId}/sections`, { name: "Супи" })).json().id;
    itemA = (await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items`, { sectionId, name: "Борщ", price: "120" })).json().id;
    itemB = (await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items`, { sectionId, name: "Крем-суп", price: "110" })).json().id;
  });

  /** Те, що зробив би воркер: варіанти + облік вартості. */
  async function pretendWorker(itemId: string, n: number, isAi = true) {
    let [job] = await t.db.select().from(aiJobs).where(eq(aiJobs.refId, itemId)).orderBy(desc(aiJobs.createdAt)).limit(1);
    if (!job) [job] = await t.db.insert(aiJobs).values({ orgId, kind: isAi ? "dish_image" : "dish_upload", refId: itemId, payload: {} }).returning();
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [img] = await t.db.insert(dishImages).values({
        orgId, itemId, status: "ready", file: `dish/${itemId}-${i}.jpg`, thumb: `dish/${itemId}-${i}-t.jpg`,
        width: 900, height: 900, bytes: 1000, isAi, provider: "xai", model: "grok-imagine-image-2.0", prompt: "p",
      }).returning();
      ids.push(img!.id);
    }
    if (isAi) {
      await t.db.insert(aiUsage).values({ orgId, jobId: job!.id, kind: "dish_image", provider: "xai", model: "grok-imagine-image-2.0", images: n, costMicros: 40_000 * n });
    }
    await t.db.update(aiJobs).set({ status: "done", finishedAt: new Date() }).where(eq(aiJobs.id, job!.id));
    return ids;
  }

  it("owner ставить задачу на варіанти, друга задача на ту саму страву відхиляється", async () => {
    const res = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items/${itemA}/images`, { n: 3 });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ itemId: itemA, variants: 3, status: "queued" });

    const again = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items/${itemA}/images`, { n: 3 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("in_progress");

    expect((await staff.post(`/api/orgs/${orgId}/menus/${menuId}/items/${itemB}/images`)).statusCode).toBe(403);
  });

  it("варіанти видно, вибір позначає страву як AI-фото", async () => {
    const ids = await pretendWorker(itemA, 3);
    const list = await staff.get(`/api/orgs/${orgId}/menus/${menuId}/items/${itemA}/images`);
    expect(list.statusCode).toBe(200);
    expect(list.json().images).toHaveLength(3);
    expect(list.json().job.status).toBe("done");

    const chosen = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items/${itemA}/images/${ids[1]}/choose`);
    expect(chosen.statusCode).toBe(200);
    expect(chosen.json()).toMatchObject({ imageId: ids[1], imageIsAi: true });
    // чуже фото до цієї страви не прикрутиш
    expect((await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items/${itemB}/images/${ids[1]}/choose`)).statusCode).toBe(404);
  });

  it("ліміт страв із AI-фото і місячний ліміт зображень", async () => {
    // ai_dishes: 1 — борщ уже з AI-фото, друга страва не проходить
    // місячного ліміту ще вистачає (3 з 6), але страва з AI-фото дозволена лише одна
    const limited = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items/${itemB}/images`);
    expect(limited.statusCode).toBe(409);
    expect(limited.json().error).toBe("plan_limit");
    expect(limited.json().message).toMatch(/dish/);

    const usage = await owner.get(`/api/orgs/${orgId}/ai-usage`);
    expect(usage.json()).toMatchObject({ imagesMonth: 3, dishesWithAi: 1, costMicros: 120_000 });
    expect(usage.json().remaining).toEqual({ images: 3, dishes: 0 });
    expect((await staff.get(`/api/orgs/${orgId}/ai-usage`)).statusCode).toBe(403);

    // добираємо місячний ліміт: навіть перегенерація вже врахованої страви впирається в нього
    await t.db.insert(aiUsage).values({ orgId, kind: "dish_image", provider: "xai", model: "m", images: 3, costMicros: 120_000 });
    const month = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items/${itemA}/images`, { n: 1 });
    expect(month.statusCode).toBe(409);
    expect(month.json().message).toMatch(/per month/);
  });

  it("власне фото не рахується як AI і замінює вибране", async () => {
    const [own] = await pretendWorker(itemB, 1, false).then(async (ids) => {
      await t.db.update(aiJobs).set({ kind: "dish_upload" }).where(eq(aiJobs.refId, itemB));
      return ids;
    });
    const res = await owner.post(`/api/orgs/${orgId}/menus/${menuId}/items/${itemB}/images/${own}/choose`);
    expect(res.statusCode).toBe(200);
    expect(res.json().imageIsAi).toBe(false);
    expect((await owner.get(`/api/orgs/${orgId}/ai-usage`)).json().dishesWithAi).toBe(1);
  });

  it("видалення обраного фото лишає страву без фото", async () => {
    const list = (await owner.get(`/api/orgs/${orgId}/menus/${menuId}/items/${itemA}/images`)).json();
    const del = await owner.del(`/api/orgs/${orgId}/menus/${menuId}/items/${itemA}/images/${list.chosen}`);
    expect(del.statusCode).toBe(204);
    const after = (await owner.get(`/api/orgs/${orgId}/menus/${menuId}/items/${itemA}/images`)).json();
    expect(after.chosen).toBeNull();
    expect(after.imageIsAi).toBe(false);
    expect(after.images).toHaveLength(2);
  });
});
