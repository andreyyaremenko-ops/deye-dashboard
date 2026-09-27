/**
 * Камери закладу. Потік іде не напряму з NVR, а через наш сервер
 * (/api/public/screens/<token>/nvr/…): домен реєстратора зазвичай відкритий лише для нашого IP.
 *
 * Samsung/LG грають HLS нативно — там hls.js не вантажиться взагалі. Для решти беремо «легку»
 * збірку окремим чанком: альтернативні аудіодоріжки, субтитри й DRM камерам не потрібні.
 * Звуку немає (камери й так без нього) — інакше ТБ заборонив би автозапуск.
 * Підписане посилання живе добу, а сесія всередині плейлиста — хвилини, тому на помилку
 * перезапитуємо посилання з наростаючою паузою.
 */
import { useEffect, useRef, useState } from "preact/hooks";

export interface ScreenCamera { id: string; hlsUrl: string | null; expiresAt: string | null; error?: string }

interface Props { cls: string; token: string; props: Record<string, unknown> }

const RELOAD_MS = 30 * 60_000;   // посилання живе добу, оновлюємо з великим запасом

export function CameraWidget({ cls, token, props }: Props) {
  const list = (Array.isArray(props.cameras) ? props.cameras : []).map(String).filter(Boolean);
  const names = (Array.isArray(props.names) ? props.names : []).map(String);
  const rotateS = Math.max(0, Number(props.rotateS ?? 20) || 0);
  const plain = props.card === false;
  const title = String(props.title ?? "Камери");
  const fit = props.fit === "contain" ? "contain" : "cover";

  const [feed, setFeed] = useState<ScreenCamera[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [i, setI] = useState(0);

  // посилання на всі камери екрана одним запитом; оновлюємо періодично, бо підпис протухає
  useEffect(() => {
    if (!list.length || !token) return;
    let alive = true;
    const load = () => fetch(`/api/public/screens/${token}/cameras`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { cameras: ScreenCamera[] }) => { if (alive) { setFeed(j.cameras ?? []); setErr(null); } })
      .catch(() => { if (alive) setErr("немає звʼязку з камерами"); });
    void load();
    const t = setInterval(load, RELOAD_MS);
    return () => { alive = false; clearInterval(t); };
  }, [token, list.join(",")]);

  // ротація камер
  useEffect(() => {
    if (list.length < 2 || !rotateS) return;
    const t = setInterval(() => setI((n) => (n + 1) % list.length), rotateS * 1000);
    return () => clearInterval(t);
  }, [list.length, rotateS]);

  const id = list[Math.min(i, list.length - 1)] ?? null;
  const cam = feed?.find((c) => c.id === id) ?? null;
  const name = (names[Math.min(i, list.length - 1)] ?? "").trim() || id || "";
  const note = !list.length ? "камери не вибрані" : err ?? cam?.error ?? (feed && !cam ? "камера недоступна" : null);

  return <div class={`${cls} w-camera${plain ? " camera-plain" : ""}`}>
    {!plain && <div class="title"><span>{title}</span>{list.length > 1 && <span class="cam-name">{name}</span>}</div>}
    <div class="cam-box">
      {cam?.hlsUrl
        ? <Player key={cam.id} src={cam.hlsUrl} fit={fit} />
        : <div class="cam-msg">{note ?? "підключення…"}</div>}
      {plain && list.length > 1 && <div class="cam-tag">{name}</div>}
      {cam?.hlsUrl && list.length > 1 && <div class="cam-dots">{list.map((c, n) => <i key={c} class={n === i ? "on" : ""} />)}</div>}
    </div>
  </div>;
}

/** Один потік: нативний HLS, якщо ТБ уміє, інакше hls.js окремим чанком. */
function Player({ src, fit }: { src: string; fit: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    setFailed(false);
    let alive = true;
    let destroy: (() => void) | undefined;
    let retry: number | undefined;
    let wait = 3000;
    let resetting = false;
    const again = () => {
      if (!alive || resetting) return;
      clearTimeout(retry);
      retry = window.setTimeout(() => { wait = Math.min(wait * 2, 60_000); start(); }, wait);
    };

    // елемент після MSE лишається з відкликаним blob у src і з v.error — без скидання
    // наступний потік падає з MEDIA_ERR_SRC_NOT_SUPPORTED
    const reset = () => { resetting = true; v.removeAttribute("src"); v.load(); resetting = false; };

    const start = () => {
      if (!alive) return;
      destroy?.(); destroy = undefined;
      // Tizen/webOS/Safari: HLS у самому <video>, без зайвих 116 kB бібліотеки
      if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = src;
        v.play().catch(() => {});
        destroy = () => reset();
        return;
      }
      void import("hls.js/light").then(({ default: Hls }) => {
        if (!alive) return;
        if (!Hls.isSupported()) { setFailed(true); return; }
        const hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: false });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else again();
        });
        hls.loadSource(src);
        hls.attachMedia(v);
        v.play().catch(() => {});
        destroy = () => { hls.destroy(); reset(); };
      }).catch(() => { if (alive) setFailed(true); });
    };

    v.addEventListener("error", again);
    start();
    return () => { alive = false; clearTimeout(retry); v.removeEventListener("error", again); destroy?.(); };
  }, [src]);

  if (failed) return <div class="cam-msg">цей телевізор не програє потік</div>;
  return <video ref={ref} class={`cam-video fit-${fit}`} muted playsInline autoPlay preload="none" />;
}
