/**
 * Віджет «Пряма трансляція» (live): камера телефона/ноутбука з кабінету через MediaMTX.
 *
 * Спершу WebRTC (WHEP, оригінал без перекодування, затримка < 1 с) — де телевізор його вміє (Tizen 5+, Android TV,
 * браузери). Якщо RTCPeerConnection немає або перше з'єднання не дало кадру — HLS (<id>/tv, ~3–4 с) через Player камер.
 * Чи йде ефір, питаємо API (/api/public/live/<id>, кешується на сервері); програвач вмикаємо лише під час ефіру —
 * інакше заглушка (або нічого, якщо whenOff = hide). Поки ефір зі звуком, app.tsx глушить радіо (LIVE_AUDIO).
 * ?live=hls в адресі екрана — примусово HLS (діагностика на ТБ).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { Player, autoplay } from "./camera.tsx";

/** Подія для app.tsx: detail = true — у сцені грає трансляція зі звуком (радіо на паузу), false — більше ні. */
export const LIVE_AUDIO = "sh:live-audio";

const POLL_MS = 5000;
/** Стільки відповідей «не в ефірі» поспіль, перш ніж прибрати програвач: короткий обрив ведучого не гасить екран. */
const OFF_AFTER = 3;
/** Скільки чекати першого кадру по WebRTC, перш ніж здатись і перейти на HLS. */
const RTC_FIRST_FRAME_MS = 10_000;
const ICE_GATHER_MS = 2000;
const RTC_RETRY_MS = 2000;

const rtcCapable = () => typeof RTCPeerConnection === "function" && !/[?&]live=hls\b/.test(location.search);

export function LiveWidget({ cls, props }: { cls: string; props: Record<string, unknown> }) {
  const pathId = /^[a-z0-9]{16}$/.test(String(props.pathId ?? "")) ? String(props.pathId) : null;
  const name = String(props.name ?? "").trim();
  const sound = props.sound !== false;
  const fit = props.fit === "cover" ? "cover" : "contain";
  const plain = props.card === false;
  const hide = props.whenOff === "hide";
  const [online, setOnline] = useState(false);
  // rtc — пробуємо WebRTC; hls — WebRTC тут не вийшов, до перезавантаження сторінки граємо HLS
  const [mode, setMode] = useState<"rtc" | "hls">(rtcCapable() ? "rtc" : "hls");
  const [attempt, setAttempt] = useState(0);

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
  const player = !pathId || !online ? null
    : mode === "rtc"
      ? <RtcPlayer key={`${pathId}:${attempt}`} pathId={pathId} fit={fit} sound={sound}
          // кадр так і не прийшов — цей ТБ WebRTC не тягне; обрив після показу — ведучий перепідключився, пробуємо знову
          onEnd={(played) => { if (played) window.setTimeout(() => setAttempt((n) => n + 1), RTC_RETRY_MS); else setMode("hls"); }} />
      : <Player key={pathId} src={`/live/hls/${pathId}/tv/index.m3u8`} fit={fit} sound={sound} />;
  return <div class={`${cls} w-camera w-live${plain ? " camera-plain" : ""}`}>
    {!plain && <div class="title"><span>{name || "Пряма трансляція"}</span>{online && <span class="live-on">● наживо</span>}</div>}
    <div class="cam-box">
      {!pathId ? <div class="cam-msg">трансляцію не вибрано</div>
        : player ?? <div class="cam-msg">{name ? `«${name}» — ` : ""}зараз не в ефірі</div>}
      {plain && online && <div class="cam-tag live-tag">● наживо</div>}
    </div>
  </div>;
}

function gathered(pc: RTCPeerConnection) {
  return new Promise<void>((ok) => {
    if (pc.iceGatheringState === "complete") return ok();
    const t = window.setTimeout(ok, ICE_GATHER_MS);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); ok(); } });
  });
}

/**
 * Перегляд по WHEP: одна пропозиція з усіма кандидатами (без trickle), як у ведучого. onEnd(played) — з'єднання
 * скінчилось: played = false, якщо кадру так і не було (тоді віджет переходить на HLS).
 * Старі Chromium (Tizen 4 — 56) не мають addTransceiver і connectionState — для них offerToReceive* та iceConnectionState.
 */
function RtcPlayer({ pathId, fit, sound, onEnd }: { pathId: string; fit: string; sound: boolean; onEnd: (played: boolean) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current!;
    let alive = true, played = false, location: string | null = null;
    let unmuteOff: (() => void) | undefined;
    const pc = new RTCPeerConnection({ bundlePolicy: "max-bundle" });
    const end = () => { if (!alive) return; alive = false; cleanup(); onEnd(played); };
    const firstFrame = window.setTimeout(() => { if (!played) end(); }, RTC_FIRST_FRAME_MS);
    const onPlaying = () => { played = true; clearTimeout(firstFrame); };
    v.addEventListener("playing", onPlaying);

    pc.addEventListener("track", (e) => {
      const ms = e.streams[0] ?? new MediaStream([e.track]);
      if (v.srcObject !== ms) { v.srcObject = ms; unmuteOff?.(); unmuteOff = autoplay(v, sound); }
    });
    pc.addEventListener("iceconnectionstatechange", () => {
      const st = pc.iceConnectionState;
      if (st === "failed" || st === "closed") end();
      else if (st === "disconnected") window.setTimeout(() => { if (pc.iceConnectionState === "disconnected") end(); }, 4000);
    });

    void (async () => {
      let offer: RTCSessionDescriptionInit;
      if (typeof pc.addTransceiver === "function") {
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.addTransceiver("audio", { direction: "recvonly" });
        offer = await pc.createOffer();
      } else offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true } as RTCOfferOptions);
      await pc.setLocalDescription(offer);
      await gathered(pc);
      const r = await fetch(`/live/whip/${pathId}/whep`, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: pc.localDescription!.sdp });
      if (!r.ok) throw new Error(`WHEP ${r.status}`);
      location = r.headers.get("Location");
      await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
    })().catch((e: unknown) => { console.warn("live: WebRTC failed, falling back", e); end(); });

    function cleanup() {
      clearTimeout(firstFrame);
      v.removeEventListener("playing", onPlaying);
      unmuteOff?.();
      pc.close();
      v.srcObject = null;
      // сесію на сервері закриваємо явно, інакше MediaMTX тримає її до тайм-ауту
      if (location) void fetch(location, { method: "DELETE" }).catch(() => {});
    }
    return () => { if (alive) { alive = false; cleanup(); } };
  }, [pathId]);
  return <video ref={ref} class={`cam-video fit-${fit}`} muted={!sound} playsInline autoPlay />;
}
