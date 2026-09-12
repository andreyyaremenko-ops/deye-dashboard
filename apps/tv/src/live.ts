/**
 * Живі дані: REST для старту + WebSocket з перепідключенням і watchdog.
 * ТБ-браузери засинають і рвуть сокети мовчки — тому:
 *  - якщо 90 с немає жодного повідомлення (включно з pong), сокет перестворюється;
 *  - при поверненні вкладки з фону — теж;
 *  - останній стан завжди лишається на екрані, лише позначається як застарілий.
 */
import type { DeviceState, PublicScreen, ConnStatus } from "./types.ts";

const STALE_MS = 60_000;
const WATCHDOG_MS = 90_000;

export interface LiveStore {
  screen: PublicScreen | null;
  states: Map<string, DeviceState>;
  status: ConnStatus;
  error: string | null;
}

export function startLive(token: string, onChange: (s: LiveStore) => void) {
  const store: LiveStore = { screen: null, states: new Map(), status: "connecting", error: null };
  let ws: WebSocket | null = null;
  let lastMsg = Date.now();
  let backoff = 1000;
  let stopped = false;
  const emit = () => onChange({ ...store, states: new Map(store.states) });

  async function load() {
    try {
      const r = await fetch(`/api/public/screens/${encodeURIComponent(token)}`, { cache: "no-store" });
      if (!r.ok) { store.error = r.status === 404 ? "Екран не знайдено або посилання перевипущене" : `Помилка ${r.status}`; store.status = "offline"; emit(); return false; }
      const s = (await r.json()) as PublicScreen;
      store.screen = s;
      for (const st of s.states) store.states.set(st.deviceId, st);
      store.error = null;
      emit();
      return true;
    } catch {
      store.error = "Немає звʼязку з сервером"; store.status = "offline"; emit(); return false;
    }
  }

  function connect() {
    if (stopped) return;
    try { ws?.close(); } catch { /* ignore */ }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => { lastMsg = Date.now(); backoff = 1000; store.status = "live"; emit(); };
    ws.onmessage = (ev) => {
      lastMsg = Date.now();
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === "hello") {
        for (const st of msg.states as DeviceState[]) store.states.set(st.deviceId, st);
      } else if (msg.type === "config") {
        // екран змінили в кабінеті: новий конфіг без перезавантаження
        store.screen = msg.screen as PublicScreen;
        for (const st of (msg.screen as PublicScreen).states) store.states.set(st.deviceId, st);
      } else if (msg.type === "state") {
        store.states.set(msg.deviceId, { deviceId: msg.deviceId, updatedAt: msg.updatedAt, metrics: msg.metrics, stale: false });
      }
      store.status = "live";
      emit();
    };
    ws.onclose = () => { if (stopped) return; store.status = "reconnecting"; emit(); scheduleReconnect(); };
    ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
  }

  let reconnectTimer: number | undefined;
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(async () => {
      backoff = Math.min(backoff * 2, 30_000);
      if (!store.screen) await load();
      connect();
    }, backoff);
  }

  // watchdog: мовчазний сокет, застарілість, повернення з фону
  const tick = window.setInterval(() => {
    const now = Date.now();
    if (store.status === "live" && now - lastMsg > WATCHDOG_MS) { store.status = "reconnecting"; emit(); connect(); }
    let changed = false;
    for (const st of store.states.values()) {
      const stale = now - Date.parse(st.updatedAt) > STALE_MS;
      if (stale !== st.stale) { st.stale = stale; changed = true; }
    }
    if (changed) emit();
  }, 5000);
  const onVisible = () => { if (document.visibilityState === "visible" && ws?.readyState !== WebSocket.OPEN) connect(); };
  document.addEventListener("visibilitychange", onVisible);

  // раз на добу повне перезавантаження: витоки памʼяті в ТБ-браузерах
  const reload = window.setTimeout(() => location.reload(), 24 * 3600_000);

  void load().then((ok) => { if (ok) connect(); else scheduleReconnect(); });

  return () => {
    stopped = true; clearInterval(tick); clearTimeout(reconnectTimer); clearTimeout(reload);
    document.removeEventListener("visibilitychange", onVisible); try { ws?.close(); } catch { /* ignore */ }
  };
}
