/**
 * WebSocket /ws?token=<viewToken>: пушить стан пристроїв екрана.
 * Клієнт нічого не шле; ping/pong для watchdog на ТБ.
 */
import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { AppDeps } from "./app.ts";
import { publicScreen } from "./screens/service.ts";
import { isStale } from "./state/store.ts";

export async function registerWs(app: FastifyInstance, deps: AppDeps) {
  await app.register(websocket, { options: { maxPayload: 1024 } });

  app.get("/ws", { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    if (!token || token.length < 20) { socket.close(1008, "token required"); return; }
    let screen;
    try { screen = await publicScreen(deps.db, token); }
    catch { socket.close(1008, "unknown screen"); return; }
    let ids = new Set(screen.deviceIds);
    const screenId = screen.id;

    const send = (o: unknown) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o)); };
    const states = await deps.store.getMany([...ids]);
    send({ type: "hello", screenId, states: states.map((s) => ({ ...s, stale: isStale(s) })) });

    const unsub = deps.store.subscribe((s) => { if (ids.has(s.deviceId)) send({ type: "state", ...s, stale: false }); });
    // екран змінили в кабінеті: шлемо новий конфіг (або закриваємо, якщо токен перевипущено)
    const unsubScreen = deps.store.subscribeScreens(async (id) => {
      if (id !== screenId) return;
      try {
        const fresh = await publicScreen(deps.db, token);
        ids = new Set(fresh.deviceIds);
        const st = await deps.store.getMany([...ids]);
        send({ type: "config", screen: { ...fresh, states: st.map((s) => ({ ...s, stale: isStale(s) })) } });
      } catch { socket.close(1008, "screen gone"); }
    });
    const ping = setInterval(() => { if (socket.readyState === socket.OPEN) socket.ping(); }, 25_000);
    const cleanup = () => { unsub(); unsubScreen(); clearInterval(ping); };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
