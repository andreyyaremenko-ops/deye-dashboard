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
    const ids = new Set(screen.deviceIds);

    const send = (o: unknown) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(o)); };
    const states = await deps.store.getMany([...ids]);
    send({ type: "hello", screenId: screen.id, states: states.map((s) => ({ ...s, stale: isStale(s) })) });

    const unsub = deps.store.subscribe((s) => { if (ids.has(s.deviceId)) send({ type: "state", ...s, stale: false }); });
    const ping = setInterval(() => { if (socket.readyState === socket.OPEN) socket.ping(); }, 25_000);
    socket.on("close", () => { unsub(); clearInterval(ping); });
    socket.on("error", () => { unsub(); clearInterval(ping); });
  });
}
