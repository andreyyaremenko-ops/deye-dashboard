import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import * as tgs from "../telegram/service.ts";
import { createBot } from "../telegram/bot.ts";
import type { TgUpdate } from "../telegram/client.ts";
import { member, orgIdParams, orgParams, type Deps } from "./common.ts";
import { badRequest } from "../lib/errors.ts";

const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Телеграм-бот закладу: вебхук від Telegram і прив'язка акаунтів у кабінеті (адмін). */
export async function telegramRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const tg = deps.telegram ?? null;
  const bot = tg ? createBot({ db, tg: tg.client, store: deps.store, mediaRoot: deps.mediaRoot, convert: deps.telegramConvert, bgPollMs: deps.telegramBgPollMs, log: app.log }) : null;

  // Telegram шле секрет у заголовку (setWebhook secret_token); відповідаємо 200 завжди, інакше він повторює оновлення
  app.post("/api/telegram/webhook", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
    const secret = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
    if (!tg || !bot || !same(secret, tg.secret)) return reply.code(401).send();
    await bot.handle(req.body as TgUpdate);
    return reply.code(200).send({ ok: true });
  });

  app.get("/api/orgs/:orgId/telegram", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "admin");
    return { enabled: !!tg, botUsername: tg?.info.username ?? null, links: await tgs.listLinks(db, orgId) };
  });
  app.post("/api/orgs/:orgId/telegram/code", async (req) => {
    const { orgId, u } = await member(deps, req, orgParams, "admin");
    if (!tg) throw badRequest("Телеграм-бот не налаштований на сервері", "telegram_off");
    const { code, expiresAt } = await tgs.issueCode(db, orgId, u.id);
    return { code, expiresAt, link: tg.info.username ? `https://t.me/${tg.info.username}?start=${code}` : null };
  });
  app.delete("/api/orgs/:orgId/telegram/:id", async (req, reply) => {
    const { orgId, id } = await member(deps, req, orgIdParams, "admin");
    await tgs.deleteLink(db, orgId, id);
    return reply.code(204).send();
  });
}
