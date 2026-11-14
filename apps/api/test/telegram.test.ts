import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";
import { ffmpegToMp3 } from "../src/telegram/audio.ts";
import type { InlineButton, TelegramBot, TelegramClient, TgUpdate } from "../src/telegram/client.ts";

/** Підроблений Telegram: запам'ятовує, що бот надсилав. */
function fakeTelegram() {
  const sent: { chatId: number; text: string; buttons?: InlineButton[][] }[] = [];
  const edits: { chatId: number; messageId: number; text: string }[] = [];
  const answers: { id: string; text?: string }[] = [];
  const client: TelegramClient = {
    async getMe() { return { id: 1, username: "sunhunter_test_bot" }; },
    async setWebhook() {},
    async sendMessage(chatId, text, buttons) { sent.push({ chatId, text, buttons }); return { message_id: sent.length }; },
    async editMessage(chatId, messageId, text) { edits.push({ chatId, messageId, text }); },
    async answerCallback(id, text) { answers.push({ id, text }); },
    async download(fileId) { return Buffer.from(`ogg:${fileId}`); },
  };
  const bot: TelegramBot = { client, secret: "test-secret", info: { username: "sunhunter_test_bot" } };
  return { bot, sent, edits, answers, last: () => sent[sent.length - 1]?.text ?? "", lastButtons: () => sent[sent.length - 1]?.buttons ?? [] };
}

describe("телеграм-бот: прив'язка", () => {
  let t: TestApp;
  const tg = fakeTelegram();
  let owner: ReturnType<typeof api>, staff: ReturnType<typeof api>;
  let orgId: string;
  let upd = 1;
  const user = { id: 555001, first_name: "Олена", last_name: "К." };
  const say = (text: string, from = user, secret = "test-secret") => t.app.inject({
    method: "POST", url: "/api/telegram/webhook", headers: { "x-telegram-bot-api-secret-token": secret },
    payload: { update_id: upd++, message: { message_id: upd, chat: { id: from.id, type: "private" }, from, text } } satisfies TgUpdate,
  });

  beforeAll(async () => {
    t = await makeTestApp({ telegram: tg.bot });
    const o = await signUp(t.app, "owner@tg.test"); owner = api(t.app, o.cookie);
    const s = await signUp(t.app, "staff@tg.test"); staff = api(t.app, s.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Кавʼярня" })).json().id;
    const inv = (await owner.post(`/api/orgs/${orgId}/invites`, {})).json();
    await staff.post(`/api/invites/${inv.token}/accept`);
  });
  afterAll(async () => { await t.close(); });

  it("вебхук без правильного секрету — 401, бот мовчить", async () => {
    expect((await say("/start", user, "wrong")).statusCode).toBe(401);
    expect(tg.sent).toHaveLength(0);
  });

  it("гість отримує підказку про код", async () => {
    expect((await say("/start")).statusCode).toBe(200);
    expect(tg.last()).toContain("6-значний код");
  });

  it("адмін видає код (персонал — ні), код прив'язує акаунт один раз", async () => {
    expect((await staff.post(`/api/orgs/${orgId}/telegram/code`)).statusCode).toBe(403);
    const r = (await owner.post(`/api/orgs/${orgId}/telegram/code`)).json();
    expect(r.code).toMatch(/^\d{6}$/);
    expect(r.link).toBe(`https://t.me/sunhunter_test_bot?start=${r.code}`);

    await say(`/start ${r.code}`);
    expect(tg.last()).toContain("Підключено до «Кавʼярня»");
    const st = (await owner.get(`/api/orgs/${orgId}/telegram`)).json();
    expect(st.enabled).toBe(true);
    expect(st.links.map((l: { tgName: string }) => l.tgName)).toEqual(["Олена К."]);

    // той самий код удруге не спрацює (одноразовий), навіть для іншого акаунта
    await say(`/start ${r.code}`, { id: 555002, first_name: "Чужий" } as typeof user);
    expect(tg.last()).toContain("не знайдено");
  });

  it("код можна надіслати просто цифрами; повторна прив'язка — «вже підключені»", async () => {
    const { code } = (await owner.post(`/api/orgs/${orgId}/telegram/code`)).json();
    await say(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(tg.last()).toContain("Ви вже підключені до «Кавʼярня»");
  });

  it("перебір кодів зупиняється після 5 невірних", async () => {
    const guess = { id: 555003, first_name: "Перебір" } as typeof user;
    for (let i = 0; i < 5; i++) { await say("/start 000000", guess); expect(tg.last()).toContain("не знайдено"); }
    const { code } = (await owner.post(`/api/orgs/${orgId}/telegram/code`)).json();
    await say(`/start ${code}`, guess);
    expect(tg.last()).toContain("Забагато");
  });

  it("/unlink відключає; адмін може відв'язати з кабінету", async () => {
    await say("/unlink");
    expect(tg.last()).toContain("Відключено");
    expect((await owner.get(`/api/orgs/${orgId}/telegram`)).json().links).toHaveLength(0);

    const { code } = (await owner.post(`/api/orgs/${orgId}/telegram/code`)).json();
    await say(`/start ${code}`);
    const [link] = (await owner.get(`/api/orgs/${orgId}/telegram`)).json().links;
    expect((await staff.del(`/api/orgs/${orgId}/telegram/${link.id}`)).statusCode).toBe(403);
    expect((await owner.del(`/api/orgs/${orgId}/telegram/${link.id}`)).statusCode).toBe(204);
    await say("привіт");
    expect(tg.last()).toContain("6-значний код");
  });
});

describe("телеграм-бот не налаштований", () => {
  it("вебхук 401, видати код — зрозуміла помилка", async () => {
    const t = await makeTestApp();
    const o = await signUp(t.app, "o@notg.test"); const owner = api(t.app, o.cookie);
    const orgId = (await owner.post("/api/orgs", { name: "Без бота" })).json().id;
    expect((await t.app.inject({ method: "POST", url: "/api/telegram/webhook", payload: {} })).statusCode).toBe(401);
    expect((await owner.get(`/api/orgs/${orgId}/telegram`)).json()).toMatchObject({ enabled: false, botUsername: null, links: [] });
    const r = await owner.post(`/api/orgs/${orgId}/telegram/code`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe("telegram_off");
    await t.close();
  });
});

describe("телеграм-бот: голосові на екрани", () => {
  let t: TestApp;
  const tg = fakeTelegram();
  let owner: ReturnType<typeof api>;
  let orgId: string, hall: { id: string }, bar: { id: string };
  let upd = 1000;
  const user = { id: 777001, first_name: "Андрій" };
  const post = (payload: TgUpdate) => t.app.inject({ method: "POST", url: "/api/telegram/webhook", headers: { "x-telegram-bot-api-secret-token": "test-secret" }, payload });
  const msg = (extra: Record<string, unknown>, from = user) => post({ update_id: upd++, message: { message_id: upd, chat: { id: from.id, type: "private" }, from, ...extra } as TgUpdate["message"] });
  const voice = (duration = 7, from = user) => msg({ voice: { file_id: `f${upd}`, file_unique_id: `u${upd}`, duration, file_size: 30_000 } }, from);
  const press = (data: string, from = user) => post({ update_id: upd++, callback_query: { id: `cb${upd}`, from, data, message: { message_id: 42, chat: { id: from.id } } } });
  const link = async (org: string, from = user) => { const { code } = (await owner.post(`/api/orgs/${org}/telegram/code`)).json(); await msg({ text: `/start ${code}` }, from); };

  beforeAll(async () => {
    t = await makeTestApp({ telegram: tg.bot, telegramConvert: async (b) => Buffer.from(`mp3<${b.toString()}>`) });
    const o = await signUp(t.app, "owner@tgv.test"); owner = api(t.app, o.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Кавʼярня" })).json().id;
    await t.db.update((await import("../src/db/schema.ts")).organizations).set({ planId: "pro" });
    hall = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "Зал" })).json();
    bar = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "Бар" })).json();
    await link(orgId);
  });
  afterAll(async () => { await t.close(); });

  it("голосове: mp3 у /media/voice, кнопки екранів, доставка на вибраний", async () => {
    t.store.sentToScreens.length = 0;
    await voice(7);
    expect(tg.last()).toContain("🎙 Голосове 0:07");
    const buttons = tg.lastButtons().flat();
    expect(buttons.map((b) => b.text)).toEqual(["📺 Бар", "📺 Зал", "📢 На всі екрани", "✖ Скасувати"]);
    expect(buttons.every((b) => Buffer.byteLength(b.callback_data) <= 64)).toBe(true);
    expect(t.store.sentToScreens).toHaveLength(0);   // до вибору нічого не летить

    await press(buttons[1]!.callback_data);
    expect(t.store.sentToScreens).toHaveLength(1);
    const sent = t.store.sentToScreens[0]!;
    expect(sent.screenId).toBe(hall.id);
    expect(sent.msg).toMatchObject({ type: "tg_message", kind: "voice", from: "Андрій", durationS: 7 });
    const url = String(sent.msg.url);
    expect(url).toMatch(/^\/media\/voice\/[\w-]+\.mp3$/);
    expect(existsSync(join(t.mediaRoot, url.replace("/media/", "")))).toBe(true);
    expect(tg.edits.at(-1)!.text).toContain("⚠️ Зал — зараз жоден ТБ не підключений");

    // кнопку вже натиснули — вдруге не спрацює
    await press(buttons[0]!.callback_data);
    expect(t.store.sentToScreens).toHaveLength(1);
    expect(tg.answers.at(-1)!.text).toContain("неактуальне");
  });

  it("«на всі екрани» і «скасувати»", async () => {
    t.store.sentToScreens.length = 0;
    await voice(3);
    const all = tg.lastButtons().flat().find((b) => b.text.includes("На всі"))!;
    await press(all.callback_data);
    expect(t.store.sentToScreens.map((x) => x.screenId).sort()).toEqual([hall.id, bar.id].sort());

    await voice(3);
    const cancel = tg.lastButtons().flat().find((b) => b.text.includes("Скасувати"))!;
    await press(cancel.callback_data);
    expect(t.store.sentToScreens).toHaveLength(2);
    expect(tg.edits.at(-1)!.text).toContain("Скасовано");
  });

  it("чужа кнопка не спрацьовує", async () => {
    t.store.sentToScreens.length = 0;
    await voice(2);
    const b = tg.lastButtons().flat()[0]!;
    await press(b.callback_data, { id: 999, first_name: "Чужий" });
    expect(t.store.sentToScreens).toHaveLength(0);
  });

  it("заклад з одним екраном — одразу, без питання", async () => {
    const solo = (await owner.post("/api/orgs", { name: "Кіоск" })).json().id;
    const scr = (await owner.post(`/api/orgs/${solo}/screens`, { name: "Вітрина" })).json();
    const other = { id: 777002, first_name: "Ольга" };
    await link(solo, other);
    t.store.sentToScreens.length = 0;
    await voice(4, other);
    expect(t.store.sentToScreens.map((x) => x.screenId)).toEqual([scr.id]);
    expect(tg.last()).toContain("Вітрина");
  });

  it("задовге не приймаємо; частоту обмежено", async () => {
    await voice(181);
    expect(tg.last()).toContain("Задовге");
    const spam = { id: 777003, first_name: "Багато" };
    await link(orgId, spam);
    for (let i = 0; i < 10; i++) { await voice(1, spam); await press(tg.lastButtons().flat()[0]!.callback_data, spam); }
    await voice(1, spam);
    expect(tg.last()).toContain("Забагато");
  });
});

describe("ffmpegToMp3", () => {
  const hasFfmpeg = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();
  it.skipIf(!hasFfmpeg)("OGG/Opus (як голосове Telegram) -> MP3", async () => {
    const ogg = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", "-f", "ogg", "pipe:1"]);
    const mp3 = await ffmpegToMp3(ogg);
    expect(mp3.length).toBeGreaterThan(1000);
    // MP3: тег ID3 або одразу кадр (синхрослово 0xFFE)
    expect(mp3.subarray(0, 3).toString() === "ID3" || (mp3[0] === 0xff && (mp3[1]! & 0xe0) === 0xe0)).toBe(true);
  });
});

describe("телеграм-бот: банери й фони", () => {
  let t: TestApp;
  const tg = fakeTelegram();
  let owner: ReturnType<typeof api>;
  let orgId: string, hall: { id: string }, bar: { id: string };
  let upd = 5000;
  const user = { id: 888001, first_name: "Марія" };
  const post = (payload: TgUpdate) => t.app.inject({ method: "POST", url: "/api/telegram/webhook", headers: { "x-telegram-bot-api-secret-token": "test-secret" }, payload });
  const msg = (extra: Record<string, unknown>, from = user) => post({ update_id: upd++, message: { message_id: upd, chat: { id: from.id, type: "private" }, from, ...extra } as TgUpdate["message"] });
  const press = (data: string, from = user) => post({ update_id: upd++, callback_query: { id: `cb${upd}`, from, data, message: { message_id: 42, chat: { id: from.id } } } });
  const link = async (org: string, from = user) => { const { code } = (await owner.post(`/api/orgs/${org}/telegram/code`)).json(); await msg({ text: `/start ${code}` }, from); };
  const until = async (cond: () => boolean | Promise<boolean>) => { for (let i = 0; i < 100 && !(await cond()); i++) await new Promise((r) => setTimeout(r, 20)); };
  const btn = (label: string) => tg.lastButtons().flat().find((b) => b.text.includes(label))!;
  let schema: typeof import("../src/db/schema.ts");

  beforeAll(async () => {
    schema = await import("../src/db/schema.ts");
    t = await makeTestApp({ telegram: tg.bot, telegramBgPollMs: 20 });
    const o = await signUp(t.app, "owner@tgb.test"); owner = api(t.app, o.cookie);
    orgId = (await owner.post("/api/orgs", { name: "Кавʼярня" })).json().id;
    await t.db.update(schema.organizations).set({ planId: "pro" });
    hall = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "Зал" })).json();
    bar = (await owner.post(`/api/orgs/${orgId}/screens`, { name: "Бар" })).json();
    await link(orgId);
  });
  afterAll(async () => { await t.close(); });

  it("текст — банер на вибраний екран, час показу від довжини", async () => {
    t.store.sentToScreens.length = 0;
    await msg({ text: "Сьогодні живa музика о 19:00!" });
    expect(tg.last()).toContain("✍️ Банер: «Сьогодні живa музика о 19:00!»");
    await press(btn("Бар").callback_data);
    expect(t.store.sentToScreens).toHaveLength(1);
    expect(t.store.sentToScreens[0]).toMatchObject({ screenId: bar.id, msg: { type: "tg_message", kind: "text", text: "Сьогодні живa музика о 19:00!", from: "Марія", seconds: 15 } });

    await msg({ text: "а".repeat(301) });
    expect(tg.last()).toContain("до 300 символів");
  });

  it("фото — у фони закладу; готовий фон можна поставити на екран", async () => {
    await msg({ photo: [{ file_id: "small", file_unique_id: "s", width: 90, height: 60, file_size: 900 }, { file_id: "big", file_unique_id: "b", width: 1920, height: 1080, file_size: 300_000 }], caption: "Тераса" });
    expect(tg.last()).toContain("🖼 «Тераса» додано у фони «Кавʼярня» — обробляється");
    const [bg] = await t.db.select().from(schema.backgrounds).where((await import("drizzle-orm")).eq(schema.backgrounds.name, "Тераса"));
    expect(bg).toMatchObject({ orgId, kind: "image", status: "uploaded", category: "Мої" });
    const jobs = await t.db.select().from(schema.transcodeJobs);
    expect(jobs.some((j) => j.backgroundId === bg!.id)).toBe(true);

    // «воркер» обробив — бот пропонує поставити на екран
    const before = tg.sent.length;
    await t.db.update(schema.backgrounds).set({ status: "ready" }).where((await import("drizzle-orm")).eq(schema.backgrounds.id, bg!.id));
    await until(() => tg.sent.length > before);
    expect(tg.last()).toContain("✅ Фон «Тераса» готовий");
    expect(tg.lastButtons().flat().map((b) => b.text)).toEqual(["📺 Бар", "📺 Зал", "📢 На всі екрани", "Ні, лише в галерею"]);

    t.store.notified.length = 0;
    await press(btn("Зал").callback_data);
    expect(tg.edits.at(-1)!.text).toBe("✅ Фон «Тераса» тепер на: Зал.");
    expect(t.store.notified).toEqual([hall.id]);
    const scr = (await owner.get(`/api/orgs/${orgId}/screens`)).json().find((s: { id: string }) => s.id === hall.id);
    expect(scr.config.scenes.every((sc: { backgroundId: string }) => sc.backgroundId === bg!.id)).toBe(true);
  });

  it("фон не обробився — бот каже про це; не фото й не відео — відмова", async () => {
    const { eq } = await import("drizzle-orm");
    await msg({ video: { file_id: "v1", file_unique_id: "v1", duration: 5, width: 1280, height: 720, mime_type: "video/mp4", file_size: 900_000 } });
    const [bg] = await t.db.select().from(schema.backgrounds).where(eq(schema.backgrounds.kind, "video"));
    expect(bg!.name).toBe("З Telegram · Марія");
    const before = tg.sent.length;
    await t.db.update(schema.backgrounds).set({ status: "failed" }).where(eq(schema.backgrounds.id, bg!.id));
    await until(() => tg.sent.length > before);
    expect(tg.last()).toContain("не вдалося обробити");

    await msg({ document: { file_id: "d", file_unique_id: "d", mime_type: "application/pdf", file_name: "menu.pdf", file_size: 1000 } });
    expect(tg.last()).toContain("Такого бот не приймає");
    await msg({ video: { file_id: "huge", file_unique_id: "h", duration: 60, mime_type: "video/mp4", file_size: 50_000_000 } });
    expect(tg.last()).toContain("до 20 МБ");
  });

  it("кілька закладів — спершу питає, в який", async () => {
    const second = (await owner.post("/api/orgs", { name: "Пекарня" })).json().id;
    await t.db.update(schema.organizations).set({ planId: "pro" });
    await link(second);
    await msg({ photo: [{ file_id: "p2", file_unique_id: "p2", width: 800, height: 600, file_size: 50_000 }] });
    expect(tg.last()).toContain("У фони якого закладу?");
    await press(btn("Пекарня").callback_data);
    expect(tg.edits.at(-1)!.text).toContain("додано у фони «Пекарня»");
  });
});
