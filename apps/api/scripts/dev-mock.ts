/**
 * Локальний API без Docker: PGlite у памʼяті + MemoryStateStore, засіяна демо-організація (pro),
 * пристрій із живою телеметрією та екран. Для розробки кабінету/ТБ і скриншотів.
 *   pnpm --filter @deye/api dev:mock      # http://localhost:3000, логін demo@example.com / correct horse battery staple
 *   pnpm --filter @deye/web dev           # vite проксує /api на 3000
 */
import { eq } from "drizzle-orm";
import { makeTestApp, signUp } from "../test/helpers.ts";
import { organizations } from "../src/db/schema.ts";
import { registerDevice } from "../src/devices/service.ts";

const PORT = Number(process.env.PORT ?? 3000);
const t = await makeTestApp();
const email = "demo@example.com";
const { cookie, userId } = await signUp(t.app, email, "Демо");
const inject = <T = any>(method: "POST" | "PATCH", url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie, "content-type": "application/json" }, payload: payload as never }).then((r) => r.json() as T);

const org = await inject<{ id: string }>("POST", "/api/orgs", { name: "Кафе «Сонце»" });
await t.db.update(organizations).set({ planId: "pro" }).where(eq(organizations.id, org.id));
await registerDevice(t.db, "3494546462e6", { claimCode: "DEMO1234", hw: "esp8266" });
const dev = await inject<{ id: string }>("POST", `/api/orgs/${org.id}/devices/claim`, { code: "DEMO1234", name: "Інвертор у залі" });
const screen = await inject<{ id: string; viewToken: string }>("POST", `/api/orgs/${org.id}/screens`, { name: "Зал", config: {
  backgroundId: null, location: null, radioUrl: null, radioVolume: 0.6, tvVideo: "auto", theme: "dark",
  widgets: [
    { id: "flow-1", type: "flow", x: 3, y: 5, w: 30, h: 40, deviceId: dev.id, props: { skin: "orbit", card: true } },
    { id: "bat-1", type: "battery", x: 36, y: 5, w: 20, h: 18, deviceId: dev.id, props: {} },
    { id: "run-1", type: "runtime", x: 36, y: 26, w: 20, h: 19, deviceId: dev.id, props: {} },
    { id: "text-1", type: "text", x: 66, y: 5, w: 30, h: 60, props: { title: "Меню", text: "Еспресо — 45\nКапучино — 65\nЛате — 70\n# Десерти\nЧізкейк — 95", font: "playfair", fontSize: 1.8, align: "left", card: true } },
    { id: "clock-1", type: "clock", x: 3, y: 78, w: 22, h: 16, props: {} },
  ] } });

// телеметрія: добовий цикл, оновлення кожні 5 с
const tick = async () => {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const sun = Math.max(0, Math.sin(((h - 6) / 13) * Math.PI));
  const pv = Math.round(6200 * sun + Math.random() * 150), load = 1500 + Math.round(Math.random() * 600);
  const bat = Math.round(pv - load - 200), grid = Math.round(-(pv - load - bat));
  await t.store.set({ deviceId: dev.id, updatedAt: new Date().toISOString(), metrics: { state: "normal", pv_w: pv, load_w: load, bat_w: bat, grid_w: grid, bat_soc: 64, grid_v_l1: 231, grid_v_l2: 230, grid_v_l3: 232, grid_hz: 50, pv_day_kwh: 18.4, load_day_kwh: 22.1, grid_buy_day_kwh: 5.2, grid_sell_day_kwh: 1.3, bat_v: 51.2, inv_temp: 41 } });
};
await tick(); setInterval(() => void tick(), 5000);

await t.app.listen({ port: PORT, host: "127.0.0.1" });
console.log(JSON.stringify({ msg: "dev-mock api", url: `http://localhost:${PORT}`, email, password: "correct horse battery staple", userId, org: org.id, device: dev.id, screen: screen.id, tv: `http://localhost:${PORT}/s/${screen.viewToken}` }));
