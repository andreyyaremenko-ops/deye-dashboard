/**
 * Логіка бота закладу. Без прив'язки бот приймає лише код із кабінету (`/start <код>` або просто 6 цифр);
 * прив'язаний акаунт надсилає на екрани закладу голосові й текстові банери, а фото й відео — у галерею фонів.
 * Оновлення приходять вебхуком (routes/telegram.ts); відповідь Telegram завжди 200, помилки — у лог.
 *
 * Усі вибори (екран, заклад, куди поставити фон) — інлайн-кнопки: питання живе в пам'яті API (PENDING_TTL_MS),
 * натиснути може лише автор, і лише раз.
 */
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { asc, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { backgrounds, screens } from "../db/schema.ts";
import type { StateStore } from "../state/store.ts";
import { kindOf, storeUpload } from "../backgrounds/service.ts";
import { setScreenBackground } from "../screens/service.ts";
import { HttpError } from "../lib/errors.ts";
import type { InlineButton, TelegramClient, TgCallbackQuery, TgFileRef, TgMessage, TgUpdate } from "./client.ts";
import { TG_MAX_DOWNLOAD, tgName } from "./client.ts";
import { ffmpegToMp3, saveVoice, type AudioConverter } from "./audio.ts";
import * as tgs from "./service.ts";

type Db = PgDatabase<any, any, any>;

export interface BotDeps {
  db: Db; tg: TelegramClient; store: StateStore; mediaRoot: string;
  /** OGG/Opus -> MP3 (тести підміняють) */
  convert?: AudioConverter;
  /** як часто перевіряти, чи воркер обробив фон (тести прискорюють) */
  bgPollMs?: number;
  log?: { warn: (o: object, m: string) => void };
}

/** Найдовше голосове, яке прийматимемо: оголошення, а не подкаст. */
export const MAX_VOICE_S = 180;
/** Найдовший текстовий банер: має читатись з другого кінця залу. */
export const MAX_TEXT = 300;
/** Скільки повідомлень на екрани (і фонів) можна надіслати поспіль, щоб бот не став гучномовцем для флуду. */
const RATE_MAX = 10;
const RATE_WINDOW_MS = 10 * 60_000;
/** Скільки чекаємо вибору кнопкою. */
const PENDING_TTL_MS = 30 * 60_000;
/** Скільки чекаємо, поки воркер обробить фон, перш ніж перестати стежити. */
const BG_WATCH_MS = 20 * 60_000;

/** Що надсилаємо на телевізор (WS `tg_message`). */
export type TvMessage =
  | { kind: "voice"; url: string; from: string; durationS: number }
  | { kind: "text"; text: string; from: string; seconds: number };
type Org = { orgId: string; orgName: string };
interface Target { id: string; name: string; orgName: string }
interface Pending { tgUserId: number; chatId: number; at: number; label: string; run: (choice: string) => Promise<string> }

/** Банер висить довше, якщо текст довший: ~8 символів на секунду читання, але не менше 15 і не більше 60 с. */
export const bannerSeconds = (text: string) => Math.max(15, Math.min(60, Math.round(10 + text.length / 8)));

/** Невірних кодів поспіль від одного акаунта — далі пауза: 6 цифр не перебрати за 10 хв життя коду. */
const MAX_BAD_CODES = 5;
const BAD_CODES_WINDOW_MS = 10 * 60_000;

const HELP_LINKED = (orgs: string[]) => `Ви підключені до: ${orgs.join(", ")}.\n\n` +
  "Що можна надсилати сюди:\n🎙 голосове — прозвучить на екрані\n✍️ текст — банер на екрані\n🖼 фото чи відео (до 20 МБ) — у галерею фонів\n\n" +
  "/start — цей опис · /unlink — відключитись від усіх закладів";
const HELP_GUEST = "Вітаю! Це бот SunHunter TV.\n\nЩоб надсилати голосові й оголошення на екрани закладу, введіть 6-значний код із кабінету: " +
  "«Налаштування → Телеграм-бот → Видати код». Код можна надіслати просто цифрами.";

export function createBot(deps: BotDeps) {
  const { db, tg, store } = deps;
  const convert = deps.convert ?? ffmpegToMp3;
  const bgPollMs = deps.bgPollMs ?? 5000;
  const bad = new Map<number, { n: number; since: number }>();
  const sentBy = new Map<number, number[]>();
  const pending = new Map<string, Pending>();

  /** Екрани закладів, до яких прив'язаний акаунт. */
  async function targetsOf(orgs: Org[]): Promise<Target[]> {
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
  const count = (uid: number) => { (sentBy.get(uid) ?? sentBy.set(uid, []).get(uid)!).push(Date.now()); };

  /**
   * Запитати вибір кнопками. options — [підпис, вибір]; вибір до ~40 байт (callback_data «m:<id>:<вибір>» ≤ 64).
   * «Скасувати» додається сам. run отримує вибір і повертає текст, яким замінимо питання.
   */
  async function ask(chatId: number, uid: number, label: string, question: string, options: [string, string][], run: (choice: string) => Promise<string>, cancel = "✖ Скасувати") {
    for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL_MS) pending.delete(k);
    const id = randomBytes(6).toString("base64url");
    pending.set(id, { tgUserId: uid, chatId, at: Date.now(), label, run });
    const rows: InlineButton[][] = options.map(([text, c]) => [{ text, callback_data: `m:${id}:${c}` }]);
    rows.push([{ text: cancel, callback_data: `m:${id}:x` }]);
    await tg.sendMessage(chatId, `${label}\n${question}`, rows);
  }

  async function onCallback(q: TgCallbackQuery) {
    const mm = /^m:([\w-]+):([\w-]+)$/.exec(q.data ?? "");
    const p = mm ? pending.get(mm[1]!) : undefined;
    if (!mm || !p || p.tgUserId !== q.from.id) { await tg.answerCallback(q.id, "Це повідомлення вже неактуальне — надішліть ще раз"); return; }
    pending.delete(mm[1]!);
    await tg.answerCallback(q.id);
    const text = mm[2] === "x" ? `${p.label}\nСкасовано.` : await p.run(mm[2]!);
    const chatId = q.message?.chat.id ?? p.chatId, msgId = q.message?.message_id;
    if (msgId) await tg.editMessage(chatId, msgId, text); else await tg.sendMessage(chatId, text);
  }

  // --- голосові й банери: на вибрані екрани ---------------------------------------------------------------------

  async function deliver(uid: number, label: string, msg: TvMessage, targets: Target[], chosen: Target[]): Promise<string> {
    count(uid);
    const multi = many(targets);
    const lines: string[] = [];
    for (const t of chosen) {
      await store.sendToScreen(t.id, { type: "tg_message", ...msg });
      const tv = (await store.viewers(t.id)).length;
      lines.push(tv ? `✅ ${title(t, multi)} — ${tv} ТБ` : `⚠️ ${title(t, multi)} — зараз жоден ТБ не підключений`);
    }
    return `${label}\n${lines.join("\n")}`;
  }

  /** Запитати екран кнопками (або одразу надіслати, якщо екран один). */
  async function offer(m: TgMessage, label: string, msg: TvMessage, targets: Target[]) {
    const uid = m.from!.id;
    if (targets.length === 1) { await tg.sendMessage(m.chat.id, await deliver(uid, label, msg, targets, targets)); return; }
    const multi = many(targets);
    await ask(m.chat.id, uid, label, "На який екран?",
      [...targets.map((t, i): [string, string] => [`📺 ${title(t, multi)}`, String(i)]), ["📢 На всі екрани", "a"]],
      async (c) => {
        const chosen = c === "a" ? targets : [targets[Number(c)]].filter((t): t is Target => !!t);
        return chosen.length ? deliver(uid, label, msg, targets, chosen) : `${label}\nЕкран не знайдено.`;
      });
  }

  async function onVoice(m: TgMessage, orgs: Org[], f: TgFileRef) {
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

  async function onText(m: TgMessage, orgs: Org[], text: string) {
    if (text.length > MAX_TEXT) { await tg.sendMessage(m.chat.id, `Задовгий текст для банера: до ${MAX_TEXT} символів (зараз ${text.length}).`); return; }
    const targets = await targetsOf(orgs);
    if (!targets.length) { await tg.sendMessage(m.chat.id, "У закладі ще немає жодного екрана."); return; }
    const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    await offer(m, `✍️ Банер: «${short}»`, { kind: "text", text, from: tgName(m.from!), seconds: bannerSeconds(text) }, targets);
  }

  // --- фото й відео: у галерею фонів закладу ----------------------------------------------------------------------

  async function onMedia(m: TgMessage, orgs: Org[], f: TgFileRef, mime: string) {
    if (!kindOf(mime)) { await tg.sendMessage(m.chat.id, "Для фону підходять відео (mp4, mov, webm…) або фото (jpg, png, webp)."); return; }
    if ((f.file_size ?? 0) > TG_MAX_DOWNLOAD) {
      await tg.sendMessage(m.chat.id, "Файл завеликий: Telegram дає ботам до 20 МБ. Довге відео завантажте в кабінеті (екран → «Фон сцени» → «Змінити»)."); return;
    }
    const name = (m.caption ?? "").trim().slice(0, 80) || f.file_name?.replace(/\.[^.]+$/, "").slice(0, 80) || `З Telegram · ${tgName(m.from!)}`;
    if (orgs.length === 1) { await tg.sendMessage(m.chat.id, await upload(m, orgs[0]!, f, mime, name)); return; }
    await ask(m.chat.id, m.from!.id, `🖼 «${name}»`, "У фони якого закладу?",
      orgs.map((o, i): [string, string] => [`🏠 ${o.orgName}`, String(i)]),
      async (c) => { const o = orgs[Number(c)]; return o ? upload(m, o, f, mime, name) : "Заклад не знайдено."; });
  }

  async function upload(m: TgMessage, org: Org, f: TgFileRef, mime: string, name: string): Promise<string> {
    let bg: { id: string; name: string };
    try {
      const buf = await tg.download(f.file_id);
      bg = await storeUpload(db, org.orgId, mime, name, Readable.from(buf), deps.mediaRoot);
    } catch (e) {
      if (e instanceof HttpError && e.code === "plan_limit") return `🖼 «${name}»\nВласні фони не входять у тариф закладу «${org.orgName}».`;
      deps.log?.warn({ err: String(e) }, "telegram: background upload failed");
      return `🖼 «${name}»\nНе вдалося зберегти файл. Спробуйте ще раз.`;
    }
    count(m.from!.id);
    watchBackground(m.chat.id, m.from!.id, org, bg.id, bg.name);
    return `🖼 «${bg.name}» додано у фони «${org.orgName}» — обробляється, напишу, коли буде готовий.`;
  }

  /** Стежимо, поки воркер обробить фон; готовий — пропонуємо поставити на екран. */
  function watchBackground(chatId: number, uid: number, org: Org, id: string, name: string) {
    const until = Date.now() + BG_WATCH_MS;
    const check = async () => {
      const [row] = await db.select({ status: backgrounds.status }).from(backgrounds).where(eq(backgrounds.id, id));
      if (!row) return;
      if (row.status === "failed") { await tg.sendMessage(chatId, `❌ Фон «${name}» не вдалося обробити — можливо, файл пошкоджений чи формат незвичний.`); return; }
      if (row.status !== "ready") { if (Date.now() < until) setTimeout(() => void check().catch(warn), bgPollMs); return; }
      const targets = await targetsOf([org]);
      if (!targets.length) { await tg.sendMessage(chatId, `✅ Фон «${name}» готовий — він у галереї фонів закладу.`); return; }
      await ask(chatId, uid, `✅ Фон «${name}» готовий.`, "Поставити його фоном (на всі сцени екрана)?",
        [...targets.map((t, i): [string, string] => [`📺 ${t.name}`, String(i)]), ...(targets.length > 1 ? [["📢 На всі екрани", "a"] as [string, string]] : [])],
        async (c) => {
          const chosen = c === "a" ? targets : [targets[Number(c)]].filter((t): t is Target => !!t);
          const done: string[] = [];
          for (const t of chosen) if (await setScreenBackground(db, org.orgId, t.id, id)) { await store.notifyScreen(t.id); done.push(t.name); }
          return done.length ? `✅ Фон «${name}» тепер на: ${done.join(", ")}.` : "Екран не знайдено.";
        }, "Ні, лише в галерею");
    };
    const warn = (e: unknown) => deps.log?.warn({ err: String(e) }, "telegram: background watch failed");
    setTimeout(() => void check().catch(warn), bgPollMs);
  }

  // --- прив'язка й маршрутизація -----------------------------------------------------------------------------------

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
    if (start || text.startsWith("/")) { await tg.sendMessage(m.chat.id, HELP_LINKED(orgs.map((o) => o.orgName))); return; }
    const audio = m.voice ?? m.audio;
    const photo = m.photo?.length ? m.photo[m.photo.length - 1] : undefined;   // найбільший розмір — останній
    const media = photo ? { f: photo, mime: "image/jpeg" } : m.video ? { f: m.video, mime: m.video.mime_type ?? "video/mp4" }
      : m.document && /^(image|video)\//.test(m.document.mime_type ?? "") ? { f: m.document, mime: m.document.mime_type! } : null;
    if (!audio && !media && !text) { await tg.sendMessage(m.chat.id, "Такого бот не приймає. Надішліть голосове, текст, фото чи відео."); return; }
    if (!rateOk(m.from.id)) { await tg.sendMessage(m.chat.id, "Забагато повідомлень поспіль. Спробуйте за кілька хвилин."); return; }
    if (audio) return onVoice(m, orgs, audio);
    if (media) return onMedia(m, orgs, media.f, media.mime);
    return onText(m, orgs, text);
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
