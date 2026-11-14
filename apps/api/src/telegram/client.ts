/**
 * Мінімальний клієнт Telegram Bot API (https://core.telegram.org/bots/api) — лише те, що потрібно боту закладу.
 * Без бібліотеки: кілька методів через fetch, тести підміняють увесь клієнт.
 */
export interface TgUser { id: number; first_name?: string; last_name?: string; username?: string }
export interface TgFileRef { file_id: string; file_unique_id: string; file_size?: number; duration?: number; mime_type?: string; file_name?: string; width?: number; height?: number }
export interface TgMessage {
  message_id: number; chat: { id: number; type: string }; from?: TgUser; text?: string; caption?: string;
  voice?: TgFileRef; audio?: TgFileRef; video?: TgFileRef; photo?: TgFileRef[]; document?: TgFileRef;
}
export interface TgCallbackQuery { id: string; from: TgUser; data?: string; message?: { message_id: number; chat: { id: number } } }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }
export interface InlineButton { text: string; callback_data: string }

/** Бот може завантажити файл не більше 20 МБ (getFile). */
export const TG_MAX_DOWNLOAD = 20 * 1024 * 1024;

export interface TelegramClient {
  getMe(): Promise<{ id: number; username: string }>;
  setWebhook(url: string, secret: string): Promise<void>;
  sendMessage(chatId: number, text: string, buttons?: InlineButton[][]): Promise<{ message_id: number }>;
  editMessage(chatId: number, messageId: number, text: string): Promise<void>;
  answerCallback(id: string, text?: string): Promise<void>;
  /** Завантажити файл за file_id (до 20 МБ) */
  download(fileId: string): Promise<Buffer>;
}

export class TelegramError extends Error {}

export function httpTelegramClient(token: string, call: typeof fetch = fetch): TelegramClient {
  const base = `https://api.telegram.org/bot${token}`;
  const api = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
    const r = await call(`${base}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
    if (!j?.ok) throw new TelegramError(`${method}: ${j?.description ?? r.status}`);
    return j.result as T;
  };
  const markup = (buttons?: InlineButton[][]) => (buttons ? { reply_markup: { inline_keyboard: buttons } } : {});
  return {
    getMe: () => api("getMe", {}),
    async setWebhook(url, secret) { await api("setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false }); },
    sendMessage: (chatId, text, buttons) => api("sendMessage", { chat_id: chatId, text, ...markup(buttons) }),
    async editMessage(chatId, messageId, text) { await api("editMessageText", { chat_id: chatId, message_id: messageId, text }); },
    async answerCallback(id, text) { await api("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) }); },
    async download(fileId) {
      const f = await api<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
      if (!f.file_path) throw new TelegramError("getFile: no file_path (файл завеликий?)");
      const r = await call(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new TelegramError(`download: ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    },
  };
}

/** Ім'я для кабінету й підпису на екрані: «Ім'я Прізвище» або @username. */
export const tgName = (u: TgUser) => [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || (u.username ? `@${u.username}` : `id${u.id}`);

/** Бот, яким користується API: клієнт, секрет вебхука (з токена) і username (відомий після getMe). */
export interface TelegramBot { client: TelegramClient; secret: string; info: { username: string | null } }
