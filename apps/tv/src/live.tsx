/**
 * Віджет «Пряма трансляція» (live): камера телефона/ноутбука з кабінету, HLS із MediaMTX через наш сервер.
 * Чи йде ефір, питаємо API (/api/public/live/<id>, кешується на сервері); програвач вмикаємо лише під час ефіру —
 * інакше заглушка (або нічого, якщо whenOff = hide). Поки ефір зі звуком, app.tsx глушить радіо (LIVE_AUDIO).
 */
import { useEffect, useState } from "preact/hooks";
import { Player } from "./camera.tsx";

/** Подія для app.tsx: detail = true — у сцені грає трансляція зі звуком (радіо на паузу), false — більше ні. */
export const LIVE_AUDIO = "sh:live-audio";

const POLL_MS = 5000;
/** Стільки відповідей «не в ефірі» поспіль, перш ніж прибрати програвач: короткий обрив ведучого не гасить екран. */
const OFF_AFTER = 3;

export function LiveWidget({ cls, props }: { cls: string; props: Record<string, unknown> }) {
  const pathId = /^[a-z0-9]{16}$/.test(String(props.pathId ?? "")) ? String(props.pathId) : null;
  const name = String(props.name ?? "").trim();
  const sound = props.sound !== false;
  const fit = props.fit === "cover" ? "cover" : "contain";
  const plain = props.card === false;
  const hide = props.whenOff === "hide";
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (!pathId) return;
    let alive = true, misses = 0, timer: number | undefined;
    const poll = () => {
      fetch(`/api/public/live/${pathId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { online: boolean }) => {
          if (!alive) return;
          if (j.online) { misses = 0; setOnline(true); } else if (++misses >= OFF_AFTER) setOnline(false);
        })
        .catch(() => {})   // мережа зникла — лишаємо як було, live.ts і так перепідключиться
        .then(() => { if (alive) timer = window.setTimeout(poll, POLL_MS); });
    };
    poll();
    return () => { alive = false; clearTimeout(timer); setOnline(false); };
  }, [pathId]);

  // радіо замовкає, поки трансляція зі звуком на екрані
  useEffect(() => {
    if (!online || !sound) return;
    dispatchEvent(new CustomEvent(LIVE_AUDIO, { detail: true }));
    return () => { dispatchEvent(new CustomEvent(LIVE_AUDIO, { detail: false })); };
  }, [online, sound]);

  if (!online && hide) return null;
  return <div class={`${cls} w-camera w-live${plain ? " camera-plain" : ""}`}>
    {!plain && <div class="title"><span>{name || "Пряма трансляція"}</span>{online && <span class="live-on">● наживо</span>}</div>}
    <div class="cam-box">
      {!pathId ? <div class="cam-msg">трансляцію не вибрано</div>
        : online ? <Player key={pathId} src={`/live/hls/${pathId}/tv/index.m3u8`} fit={fit} sound={sound} />
        : <div class="cam-msg">{name ? `«${name}» — ` : ""}зараз не в ефірі</div>}
      {plain && online && <div class="cam-tag live-tag">● наживо</div>}
    </div>
  </div>;
}
