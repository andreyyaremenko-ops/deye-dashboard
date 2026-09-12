import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { startLive, type LiveStore } from "./live.ts";
import { Widget } from "./widgets.tsx";
import { GradientBackground, VideoBackground } from "./background.tsx";
import { Plaque } from "./plaque.tsx";
import { Pair, clearToken, savedToken, saveToken } from "./pair.tsx";

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
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => { if (token) return startLive(token, setLive); }, [token]);

  const radioUrl = live?.screen?.config.radioUrl ?? null;
  const radioVolume = live?.screen?.config.radioVolume ?? 0.6;
  useEffect(() => {
    const el = audio.current;
    if (!el || !radioUrl) { setNeedTap(false); return; }
    el.volume = radioVolume;
    let retry = 2000, timer: number | undefined, blocked = false;
    const start = () => { if (el.src !== radioUrl) { el.src = radioUrl; el.load(); } el.play().then(() => { blocked = false; setNeedTap(false); retry = 2000; }).catch(() => { blocked = true; setNeedTap(true); }); };
    // Автозапуск зі звуком заборонено: будь-яка кнопка пульта / дотик вмикає (як в акваріумі)
    const kick = () => { if (blocked) start(); };
    for (const ev of ["pointerdown", "touchstart", "keydown"]) addEventListener(ev, kick, true);
    // обрив стріму: перезапуск із наростаючою паузою
    const onFail = () => { if (blocked) return; clearTimeout(timer); timer = window.setTimeout(() => { retry = Math.min(retry * 2, 60_000); start(); }, retry); };
    el.addEventListener("error", onFail); el.addEventListener("stalled", onFail); el.addEventListener("ended", onFail);
    start();
    return () => {
      clearTimeout(timer);
      for (const ev of ["pointerdown", "touchstart", "keydown"]) removeEventListener(ev, kick, true);
      el.removeEventListener("error", onFail); el.removeEventListener("stalled", onFail); el.removeEventListener("ended", onFail);
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
  const src = video ? (video.startsWith("http") ? video : `/media/${video}`) : null;

  return <div class={`screen theme-${screen.config.theme}`}>
    {src ? <VideoBackground src={src} /> : <GradientBackground />}
    {screen.config.widgets.map((w) => (
      <div key={w.id} class="slot" style={{ left: `${w.x}%`, top: `${w.y}%`, width: `${w.w}%`, height: `${w.h}%` }}>
        <Widget type={w.type} state={w.deviceId ? live.states.get(w.deviceId) : undefined} props={w.props} token={token} deviceId={w.deviceId}
          device={screen.devices?.find((d) => d.id === w.deviceId)} socHistory={w.deviceId ? live.socHistory.get(w.deviceId) : undefined} />
      </div>
    ))}
    {radioUrl && <audio ref={audio} preload="none" />}
    {needTap && <div class="unmute" onClick={() => audio.current?.play().then(() => setNeedTap(false)).catch(() => {})}>🔇 Натисніть будь-яку кнопку, щоб увімкнути радіо</div>}
    {screen.branding && <div class="brand">powered by tv.sun-hunter.men</div>}
    {screen.branding && <Plaque />}
    <div class={`conn conn-${live.status}`} title={live.status} />
  </div>;
}

const Msg = ({ children }: { children: preact.ComponentChildren }) => <div class="screen theme-dark"><GradientBackground /><div class="msg">{children}</div></div>;
