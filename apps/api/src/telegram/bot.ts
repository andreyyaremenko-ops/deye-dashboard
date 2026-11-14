/**
 * Логіка бота закладу. Без прив'язки бот приймає лише код із кабінету (`/start <код>` або просто 6 цифр);
 * прив'язаний акаунт надсилає на екрани закладу голосові, текстові банери й фони (наступні етапи).
 * Оновлення приходять вебхуком (routes/telegram.ts); відповідь Telegram завжди 200, помилки — у лог.
 */
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { TelegramClient, TgMessage, TgUpdate } from "./client.ts";
import { tgName } from "./client.ts";
import * as tgs from "./service.ts";

type Db = PgDatabase<any, any, any>;

export interface BotDeps { db: Db; tg: TelegramClient; log?: { warn: (o: object, m: string) => void } }

/** Невірних кодів поспіль від одного акаунта — далі пауза: 6 цифр не перебрати за 10 хв життя коду. */
const MAX_BAD_CODES = 5;
const BAD_CODES_WINDOW_MS = 10 * 60_000;

const HELP_LINKED = (orgs: string[]) => `Ви підключені до: ${orgs.join(", ")}.\n\n` +
  "Що можна надсилати сюди:\n🎙 голосове — прозвучить на екрані\n✍️ текст — банер на екрані\n🖼 фото чи відео — у галерею фонів\n\n" +
  "/start — цей опис · /unlink — відключитись від усіх закладів";
const HELP_GUEST = "Вітаю! Це бот SunHunter TV.\n\nЩоб надсилати голосові й оголошення на екрани закладу, введіть 6-значний код із кабінету: " +
  "«Налаштування → Телеграм-бот → Видати код». Код можна надіслати просто цифрами.";

export function createBot(deps: BotDeps) {
  const { db, tg } = deps;
  const bad = new Map<number, { n: number; since: number }>();

  async function tryCode(m: TgMessage, code: string) {
    const uid = m.from!.id;
    const b = bad.get(uid);
    if (b && Date.now() - b.since < BAD_CODES_WINDOW_MS && b.n >= MAX_BAD_CODES) {
      await tg.sendMessage(m.chat.id, "Забагато невірних кодів. Спробуйте за кілька хвилин."); return;
    }
    const res = await tgs.linkByCode(db, code, uid, tgName(m.from!));
    if (!res) {
      const cur = b && Date.now() - b.since < BAD_CODES_WINDOW_MS ? b : { n: 0, since: Date.now() };
      bad.set(uid, { n: cur.n + 1, since: cur.since });
      await tg.sendMessage(m.chat.id, "Код не знайдено або він прострочений. Видайте новий у кабінеті."); return;
    }
    bad.delete(uid);
    const orgs = (await tgs.orgsOf(db, uid)).map((o) => o.orgName);
    await tg.sendMessage(m.chat.id, `${res.already ? "Ви вже підключені до" : "✅ Підключено до"} «${res.orgName}».\n\n${HELP_LINKED(orgs)}`);
  }

  async function onMessage(m: TgMessage) {
    if (!m.from || m.chat.type !== "private") return;      // лише особисті чати з ботом
    const text = (m.text ?? "").trim();
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
    if (start?.[1]) return tryCode(m, start[1]);
    if (/^\d{3}\s?\d{3}$/.test(text)) return tryCode(m, text);
    if (/^\/unlink(?:@\w+)?$/.test(text)) {
      const n = await tgs.unlinkAll(db, m.from.id);
      await tg.sendMessage(m.chat.id, n ? "Відключено від усіх закладів. Щоб повернутись — новий код із кабінету." : "Ви й так не підключені до жодного закладу.");
      return;
    }
    const orgs = await tgs.orgsOf(db, m.from.id);
    if (!orgs.length) { await tg.sendMessage(m.chat.id, HELP_GUEST); return; }
    if (start || /^\/help/.test(text)) { await tg.sendMessage(m.chat.id, HELP_LINKED(orgs.map((o) => o.orgName))); return; }
    await tg.sendMessage(m.chat.id, "Це скоро запрацює: голосові, банери й фони — наступним оновленням.");
  }

  return {
    async handle(u: TgUpdate) {
      try {
        if (u.message) await onMessage(u.message);
        else if (u.callback_query) await tg.answerCallback(u.callback_query.id);
      } catch (e) { deps.log?.warn({ err: String(e), update: u.update_id }, "telegram: update failed"); }
    },
  };
}
