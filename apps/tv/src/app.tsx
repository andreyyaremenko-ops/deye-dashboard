import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { startLive, type LiveStore } from "./live.ts";
import { Widget } from "./widgets.tsx";
import { Background, GradientBackground, isSingleMediaTv, rememberSingleMedia } from "./background.tsx";
import { Plaque } from "./plaque.tsx";
import { Pair, clearToken, savedToken, saveToken } from "./pair.tsx";
import { AlertOverlay } from "./feeds.tsx";

function tokenFromUrl(): string | null {
  const m = /^\/s\/([A-Za-z0-9_-]{20,})/.exec(location.pathname);
  return m?.[1] ?? new URLSearchParams(location.search).get("token");
}

export function App() {
  const token = useMemo(tokenFromUrl, []);
  const isPairPage = /^\/tv\/?$/.test(location.pathname) || (location.pathname.startsWith("/s") && !token);
  // /tv із збереженим токеном -> одразу на екран; /s/<token> -> запамʼятати
  useEffect(() => {
    if (isPairPage) { const t = savedToken(); if (t) location.replace(`/s/${t}`); }
    else if (token) saveToken(token);
  }, []);
  const [live, setLive] = useState<LiveStore | null>(null);
  const [needTap, setNeedTap] = useState(false);
  // ТБ, що не грає відео і радіо разом: визначено за UA або за фактом (радіо стало на паузу, щойно пішло відео)
  const [singleMedia, setSingleMedia] = useState(isSingleMediaTv);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => { if (token) return startLive(token, setLive); }, [token]);

  const radioUrl = live?.screen?.config.radioUrl ?? null;
  const radioVolume = live?.screen?.config.radioVolume ?? 0.6;
  useEffect(() => {
    const el = audio.current;
    if (!el || !radioUrl) { setNeedTap(false); return; }
    el.volume = radioVolume;
    let retry = 2000, timer: number | undefined, blocked = false;
    let wanted = false, stopping = false;
    const start = () => { if (el.src !== radioUrl) { el.src = radioUrl; el.load(); } wanted = true; el.play().then(() => { blocked = false; setNeedTap(false); retry = 2000; }).catch(() => { blocked = true; setNeedTap(true); }); };
    // паузу поставили не ми: якщо в цей момент грає відеофон — ТБ не тягне обидва; переходимо на кадр і повертаємо радіо
    const onPause = () => {
      if (!wanted || stopping || blocked) return;
      const v = document.querySelector<HTMLVideoElement>("video.bgv.on");
      if (v && !v.paused && !v.ended) { rememberSingleMedia(); setSingleMedia(true); console.warn("radio paused by video: switching to poster background"); }
      clearTimeout(timer); timer = window.setTimeout(start, 800);
    };
    el.addEventListener("pause", onPause);
    // Автозапуск зі звуком заборонено: будь-яка кнопка пульта / дотик вмикає (як в акваріумі)
    const kick = () => { if (blocked) start(); };
    for (const ev of ["pointerdown", "touchstart", "keydown"]) addEventListener(ev, kick, true);
    // обрив стріму: перезапуск із наростаючою паузою
    const onFail = () => { if (blocked) return; clearTimeout(timer); timer = window.setTimeout(() => { retry = Math.min(retry * 2, 60_000); start(); }, retry); };
    el.addEventListener("error", onFail); el.addEventListener("stalled", onFail); el.addEventListener("ended", onFail);
    start();
    return () => {
      stopping = true; clearTimeout(timer);
      for (const ev of ["pointerdown", "touchstart", "keydown"]) removeEventListener(ev, kick, true);
      el.removeEventListener("pause", onPause); el.removeEventListener("error", onFail); el.removeEventListener("stalled", onFail); el.removeEventListener("ended", onFail);
      el.pause(); el.removeAttribute("src"); el.load();
    };
  }, [radioUrl]);
  useEffect(() => { if (audio.current) audio.current.volume = radioVolume; }, [radioVolume]);

  if (isPairPage || !token) return <Pair />;
  if (live?.error && /не знайдено|перевипущене/.test(live.error)) { clearToken(); }
  if (!live?.screen) return <Msg>{live?.error ?? "Завантаження…"}</Msg>;

  const { screen } = live;
  const files = screen.background?.files;
  const video = files ? (files["1080"] ?? files["720"]) : null;
  const lite = new URLSearchParams(location.search).has("lite");   // діагностика: без відео і розмиття
  const media = (f: string) => (f.startsWith("http") ? f : `/media/${f}`);
  const preview = screen.background?.preview ? media(screen.background.preview) : null;
  const mode = screen.config.tvVideo ?? "auto";
  // радіо + відео на ТБ з одним медіаелементом -> кадр замість відео; вручну можна примусити будь-який режим
  const posterOnly = !!radioUrl && (mode === "poster" || (mode === "auto" && singleMedia));
  const src = !lite && !posterOnly && video ? media(video) : null;
  // повноекранний банер тривоги, якщо є віджет тривоги і в нього не вимкнено оверлей
  const overlay = screen.config.widgets.some((w) => w.type === "alert" && w.props?.overlay !== false);

  return <div class={`screen theme-${screen.config.theme}${lite ? " lite" : ""}`}>
    <Background src={src} poster={!lite ? preview : null} />
    {screen.config.widgets.map((w) => (
      <div key={w.id} class="slot" style={{ left: `${w.x}%`, top: `${w.y}%`, width: `${w.w}%`, height: `${w.h}%` }}>
        <Widget type={w.type} state={w.deviceId ? live.states.get(w.deviceId) : undefined} props={w.props} token={token} deviceId={w.deviceId}
          device={screen.devices?.find((d) => d.id === w.deviceId)} socHistory={w.deviceId ? live.socHistory.get(w.deviceId) : undefined}
          feeds={live.feeds} hasLocation={!!screen.location} outageSince={w.deviceId ? live.outageSince.get(w.deviceId) : undefined} />
      </div>
    ))}
    {overlay && <AlertOverlay feed={live.feeds.alert} />}
    {radioUrl && <audio ref={audio} preload="none" />}
    {needTap && <div class="unmute" onClick={() => audio.current?.play().then(() => setNeedTap(false)).catch(() => {})}>🔇 Натисніть будь-яку кнопку, щоб увімкнути радіо</div>}
    {screen.branding && <div class="brand">SunHunter TV · tv.sun-hunter.men</div>}
    {screen.branding && <Plaque />}
    <div class={`conn conn-${live.status}`} title={live.status} />
  </div>;
}

const Msg = ({ children }: { children: preact.ComponentChildren }) => <div class="screen theme-dark"><GradientBackground /><div class="msg">{children}</div></div>;
