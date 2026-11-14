/**
 * Логіка бота закладу. Без прив'язки бот приймає лише код із кабінету (`/start <код>` або просто 6 цифр);
 * прив'язаний акаунт надсилає на екрани закладу голосові, текстові банери й фони (наступні етапи).
 * Оновлення приходять вебхуком (routes/telegram.ts); відповідь Telegram завжди 200, помилки — у лог.
 */
import { randomBytes } from "node:crypto";
import { asc, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { screens } from "../db/schema.ts";
import type { StateStore } from "../state/store.ts";
import type { InlineButton, TelegramClient, TgCallbackQuery, TgFileRef, TgMessage, TgUpdate } from "./client.ts";
import { TG_MAX_DOWNLOAD, tgName } from "./client.ts";
import { ffmpegToMp3, saveVoice, type AudioConverter } from "./audio.ts";
import * as tgs from "./service.ts";

type Db = PgDatabase<any, any, any>;

export interface BotDeps {
  db: Db; tg: TelegramClient; store: StateStore; mediaRoot: string;
  /** OGG/Opus -> MP3 (тести підміняють) */
  convert?: AudioConverter;
  log?: { warn: (o: object, m: string) => void };
}

/** Найдовше голосове, яке прийматимемо: оголошення, а не подкаст. */
export const MAX_VOICE_S = 180;
/** Скільки повідомлень на екрани можна надіслати поспіль, щоб бот не став гучномовцем для флуду. */
const RATE_MAX = 10;
const RATE_WINDOW_MS = 10 * 60_000;
/** Скільки чекаємо вибору екрана кнопкою. */
const PENDING_TTL_MS = 30 * 60_000;

/** Що надсилаємо на телевізор (WS `tg_message`): поки голосове; текст і фони — наступні етапи. */
export type TvMessage = { kind: "voice"; url: string; from: string; durationS: number };
interface Target { id: string; name: string; orgName: string }
interface Pending { tgUserId: number; chatId: number; label: string; msg: TvMessage; targets: Target[]; at: number }

/** Невірних кодів поспіль від одного акаунта — далі пауза: 6 цифр не перебрати за 10 хв життя коду. */
const MAX_BAD_CODES = 5;
const BAD_CODES_WINDOW_MS = 10 * 60_000;

const HELP_LINKED = (orgs: string[]) => `Ви підключені до: ${orgs.join(", ")}.\n\n` +
  "Що можна надсилати сюди:\n🎙 голосове — прозвучить на екрані\n✍️ текст — банер на екрані\n🖼 фото чи відео — у галерею фонів\n\n" +
  "/start — цей опис · /unlink — відключитись від усіх закладів";
const HELP_GUEST = "Вітаю! Це бот SunHunter TV.\n\nЩоб надсилати голосові й оголошення на екрани закладу, введіть 6-значний код із кабінету: " +
  "«Налаштування → Телеграм-бот → Видати код». Код можна надіслати просто цифрами.";

export function createBot(deps: BotDeps) {
  const { db, tg, store } = deps;
  const convert = deps.convert ?? ffmpegToMp3;
  const bad = new Map<number, { n: number; since: number }>();
  const sentBy = new Map<number, number[]>();
  const pending = new Map<string, Pending>();

  /** Екрани всіх закладів, до яких прив'язаний акаунт. */
  async function targetsOf(orgs: { orgId: string; orgName: string }[]): Promise<Target[]> {
    if (!orgs.length) return [];
    const names = new Map(orgs.map((o) => [o.orgId, o.orgName]));
    const rows = await db.select({ id: screens.id, name: screens.name, orgId: screens.orgId }).from(screens)
      .where(inArray(screens.orgId, orgs.map((o) => o.orgId))).orderBy(asc(screens.name));
    return rows.map((r) => ({ id: r.id, name: r.name, orgName: names.get(r.orgId) ?? "" }));
  }
  const many = (ts: Target[]) => new Set(ts.map((t) => t.orgName)).size > 1;
  const title = (t: Target, multiOrg: boolean) => (multiOrg ? `${t.orgName} · ${t.name}` : t.name);

  function rateOk(uid: number) {
    const now = Date.now();
    const recent = (sentBy.get(uid) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    sentBy.set(uid, recent);
    return recent.length < RATE_MAX;
  }

  /** Доставити на вибрані екрани; текст результату для бота. */
  async function deliver(p: Pending, chosen: Target[]): Promise<string> {
    (sentBy.get(p.tgUserId) ?? sentBy.set(p.tgUserId, []).get(p.tgUserId)!).push(Date.now());
    const multi = many(p.targets);
    const lines: string[] = [];
    for (const t of chosen) {
      await store.sendToScreen(t.id, { type: "tg_message", ...p.msg });
      const tv = (await store.viewers(t.id)).length;
      lines.push(tv ? `✅ ${title(t, multi)} — ${tv} ТБ` : `⚠️ ${title(t, multi)} — зараз жоден ТБ не підключений`);
    }
    return `${p.label}\n${lines.join("\n")}`;
  }

  /** Запитати екран кнопками (або одразу надіслати, якщо екран один). */
  async function offer(m: TgMessage, label: string, msg: TvMessage, targets: Target[]) {
    const p: Pending = { tgUserId: m.from!.id, chatId: m.chat.id, label, msg, targets, at: Date.now() };
    if (targets.length === 1) { await tg.sendMessage(m.chat.id, await deliver(p, targets)); return; }
    for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL_MS) pending.delete(k);
    const id = randomBytes(6).toString("base64url");
    pending.set(id, p);
    const multi = many(targets);
    // callback_data до 64 байт: «m:<id>:<номер екрана|a>»
    const buttons: InlineButton[][] = targets.map((t, i) => [{ text: `📺 ${title(t, multi)}`, callback_data: `m:${id}:${i}` }]);
    buttons.push([{ text: "📢 На всі екрани", callback_data: `m:${id}:a` }, { text: "✖ Скасувати", callback_data: `m:${id}:x` }]);
    await tg.sendMessage(m.chat.id, `${label}\nНа який екран?`, buttons);
  }

  async function onCallback(q: TgCallbackQuery) {
    const mm = /^m:([\w-]+):(\d+|a|x)$/.exec(q.data ?? "");
    const p = mm ? pending.get(mm[1]!) : undefined;
    if (!mm || !p || p.tgUserId !== q.from.id) { await tg.answerCallback(q.id, "Це повідомлення вже неактуальне — надішліть ще раз"); return; }
    pending.delete(mm[1]!);
    const chatId = q.message?.chat.id ?? p.chatId, msgId = q.message?.message_id;
    let text: string;
    if (mm[2] === "x") text = `${p.label}\nСкасовано.`;
    else {
      const chosen = mm[2] === "a" ? p.targets : [p.targets[Number(mm[2])]].filter((t): t is Target => !!t);
      text = chosen.length ? await deliver(p, chosen) : `${p.label}\nЕкран не знайдено.`;
    }
    await tg.answerCallback(q.id);
    if (msgId) await tg.editMessage(chatId, msgId, text); else await tg.sendMessage(chatId, text);
  }

  async function onVoice(m: TgMessage, orgs: { orgId: string; orgName: string }[], f: TgFileRef) {
    if (!rateOk(m.from!.id)) { await tg.sendMessage(m.chat.id, "Забагато повідомлень поспіль. Спробуйте за кілька хвилин."); return; }
    if ((f.duration ?? 0) > MAX_VOICE_S) { await tg.sendMessage(m.chat.id, `Задовге: до ${MAX_VOICE_S / 60} хв.`); return; }
    if ((f.file_size ?? 0) > TG_MAX_DOWNLOAD) { await tg.sendMessage(m.chat.id, "Файл завеликий (Telegram дає ботам до 20 МБ)."); return; }
    const targets = await targetsOf(orgs);
    if (!targets.length) { await tg.sendMessage(m.chat.id, "У закладі ще немає жодного екрана."); return; }
    let url: string;
    try {
      const mp3 = await convert(await tg.download(f.file_id));
      url = `/media/${await saveVoice(deps.mediaRoot, randomBytes(9).toString("base64url"), mp3)}`;
    } catch (e) {
      deps.log?.warn({ err: String(e) }, "telegram: voice convert failed");
      await tg.sendMessage(m.chat.id, "Не вдалося обробити запис. Спробуйте ще раз."); return;
    }
    const d = Math.round(f.duration ?? 0);
    await offer(m, `🎙 Голосове ${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`, { kind: "voice", url, from: tgName(m.from!), durationS: d }, targets);
  }

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
    const audio = m.voice ?? m.audio;
    if (audio) return onVoice(m, orgs, audio);
    await tg.sendMessage(m.chat.id, "Текстові банери й фони — наступним оновленням. Поки що надсилайте голосові 🎙");
  }

  return {
    async handle(u: TgUpdate) {
      try {
        if (u.message) await onMessage(u.message);
        else if (u.callback_query) await onCallback(u.callback_query);
      } catch (e) { deps.log?.warn({ err: String(e), update: u.update_id }, "telegram: update failed"); }
    },
  };
}
