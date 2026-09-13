/**
 * Google Analytics 4. gtag підключається в index.html лише коли задано VITE_GA_ID
 * (deploy/.env GA_ID -> build-arg). Без нього всі виклики — no-op.
 */
declare global { interface Window { gtag?: (...args: unknown[]) => void } }

export function track(event: string, params: Record<string, unknown> = {}) {
  try { window.gtag?.("event", event, params); } catch { /* ignore */ }
}

/** SPA: сторінки рахуємо самі при зміні маршруту; шляхи кабінету узагальнюємо, щоб не слати id організацій. */
export function pageView(path: string) {
  const clean = path.replace(/\/o\/[^/]+/, "/o/:org").replace(/\/screens\/[^/]+/, "/screens/:id").replace(/\/devices\/[^/]+/, "/devices/:id").replace(/\/invite\/.+/, "/invite/:token");
  track("page_view", { page_path: clean, page_location: location.origin + clean, page_title: document.title });
}

/** Подія, яку треба відправити після повного перезавантаження (реєстрація -> location.assign). */
const PENDING = "sh_pending_event";
export function trackAfterReload(event: string, params: Record<string, unknown> = {}) {
  try { sessionStorage.setItem(PENDING, JSON.stringify({ event, params })); } catch { /* ignore */ }
}
export function flushPending() {
  try {
    const raw = sessionStorage.getItem(PENDING);
    if (!raw) return;
    sessionStorage.removeItem(PENDING);
    const { event, params } = JSON.parse(raw) as { event: string; params: Record<string, unknown> };
    track(event, params);
  } catch { /* ignore */ }
}
