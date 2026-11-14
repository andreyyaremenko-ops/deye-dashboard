import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTestApp, signUp, api, type TestApp } from "./helpers.ts";
import type { InlineButton, TelegramBot, TelegramClient, TgUpdate } from "../src/telegram/client.ts";

/** Підроблений Telegram: запам'ятовує, що бот надсилав. */
function fakeTelegram() {
  const sent: { chatId: number; text: string; buttons?: InlineButton[][] }[] = [];
  const client: TelegramClient = {
    async getMe() { return { id: 1, username: "sunhunter_test_bot" }; },
    async setWebhook() {},
    async sendMessage(chatId, text, buttons) { sent.push({ chatId, text, buttons }); return { message_id: sent.length }; },
    async editMessage() {},
    async answerCallback() {},
    async download() { return Buffer.from(""); },
  };
  const bot: TelegramBot = { client, secret: "test-secret", info: { username: "sunhunter_test_bot" } };
  return { bot, sent, last: () => sent[sent.length - 1]?.text ?? "" };
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
