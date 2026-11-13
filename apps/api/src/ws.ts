/**
 * WebSocket /ws?token=<viewToken>: пушить стан пристроїв екрана.
 * Клієнт нічого не шле; ping/pong для watchdog на ТБ.
 */
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { AppDeps } from "./app.ts";
import { publicScreen } from "./screens/service.ts";
import { isStale } from "./state/store.ts";
import { feedMatches } from "./feeds/hub.ts";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { screens } from "./db/schema.ts";

const VIEWED_EVERY_MS = 5 * 60_000;
const viewedAt = new Map<string, number>();

export async function registerWs(app: FastifyInstance, deps: AppDeps) {
  await app.register(websocket, { options: { maxPayload: 1024 } });

  app.get("/ws", { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    if (!token || token.length < 20) { socket.close(1008, "token required"); return; }
    // Закриття ловимо одразу: ТБ може закрити сокет, поки ми чекаємо базу, і тоді підписки й таймери, оформлені
    // після await, повисли б назавжди (так і було: сотні «глядачів» і MaxListenersExceeded при повільному диску).
    let closed = false;
    const cleanups: (() => void)[] = [];
    const cleanup = () => { if (closed) return; closed = true; for (const f of cleanups.splice(0)) f(); };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
    /** Після кожного await: сокет уже закрито — прибираємо зроблене і виходимо. */
    const gone = () => { if (closed) { for (const f of cleanups.splice(0)) f(); return true; } return false; };

    let screen;
    try { screen = await publicScreen(deps.db, token); }
    catch { socket.close(1008, "unknown screen"); return; }
    if (gone()) return;
    let ids = new Set(screen.deviceIds);
    const screenId = screen.id;

    const send = (o: unknown) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o)); };
    let location = screen.location;
    const states = await deps.store.getMany([...ids]);
    const feeds = deps.feeds ? await deps.feeds.forScreen(location) : { weather: null, alert: null };
    if (gone()) return;
    send({ type: "hello", screenId, states: states.map((s) => ({ ...s, stale: isStale(s) })), feeds });

    cleanups.push(deps.store.subscribe((s) => { if (ids.has(s.deviceId)) send({ type: "state", ...s, stale: false }); }));
    // екран змінили в кабінеті: шлемо новий конфіг (або закриваємо, якщо токен перевипущено)
    cleanups.push(deps.store.subscribeScreens(async (id) => {
      if (id !== screenId) return;
      try {
        const fresh = await publicScreen(deps.db, token);
        ids = new Set(fresh.deviceIds); location = fresh.location;
        const st = await deps.store.getMany([...ids]);
        const fd = deps.feeds ? await deps.feeds.forScreen(location) : { weather: null, alert: null };
        send({ type: "config", screen: { ...fresh, states: st.map((s) => ({ ...s, stale: isStale(s) })), feeds: fd } });
      } catch { socket.close(1008, "screen gone"); }
    }));
    // разові повідомлення з кабінету (перевірка сповіщень) — пересилаємо як є
    cleanups.push(deps.store.subscribeScreenMessages((id, msg) => { if (id === screenId) send(msg); }));
    // погода/тривога оновились: шлемо лише те, що стосується локації цього екрана
    cleanups.push(deps.store.subscribeFeeds(async (key) => {
      const kind = feedMatches(key, location);
      if (!kind || !deps.feeds) return;
      const data = kind === "alert" ? await deps.feeds.alertFor(location!.oblast) : await deps.feeds.getWeather(location!.lat, location!.lon);
      if (data) send({ type: "feed", name: kind, data });
    }));
    // облік підключених ТБ: heartbeat разом із ping; last_viewed_at у БД не частіше раз на 5 хв на екран і без очікування —
    // перепідключення не мають стояти в черзі на блокування одного рядка screens
    const viewer = { connId: randomUUID(), ip: req.ip, ua: String(req.headers["user-agent"] ?? "").slice(0, 200), since: new Date().toISOString(), lastSeen: new Date().toISOString() };
    const markViewed = () => {
      const now = Date.now();
      if (now - (viewedAt.get(screenId) ?? 0) < VIEWED_EVERY_MS) return;
      viewedAt.set(screenId, now);
      deps.db.update(screens).set({ lastViewedAt: new Date() }).where(eq(screens.id, screenId)).catch(() => {});
    };
    await deps.store.touchViewer(screenId, viewer);
    // прибирання глядача — після запису: закриття під час await інакше видалило б його раніше, ніж він записався
    cleanups.push(() => { void deps.store.removeViewer(screenId, viewer.connId); });
    if (gone()) return;
    markViewed();
    const ping = setInterval(() => {
      if (socket.readyState !== socket.OPEN) return;
      socket.ping();
      viewer.lastSeen = new Date().toISOString();
      void deps.store.touchViewer(screenId, viewer);
      markViewed();
    }, 25_000);
    cleanups.push(() => clearInterval(ping));
  });
}
