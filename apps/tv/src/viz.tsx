/**
 * Віджет «Візуалізація звуку»: спектр радіо, що грає на цьому екрані.
 *
 * Дані бере з аналізатора (apps/tv/src/audio.ts), який app.tsx підключає до елемента радіо.
 * Якщо спектра немає — станція не дала CORS і не пішла через наш проксі, радіо вимкнене чи
 * мовчить — малюємо ту саму сцену, але з плавної синтетичної хвилі, і чесно пишемо про це в підписі.
 * Кадрів 30 на секунду: на телевізорі різниці з 60 не видно, а процесора вдвічі менше.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { RADIO_STATIONS } from "@deye/shared/radio";
import { vizMode, vizSensitivity, vizTheme } from "@deye/shared/spectrum";
import { readSpectrum } from "./audio.ts";
import { createMemory, paint } from "./spectrum.ts";

const FRAME_MS = 1000 / 30;

interface Props { cls: string; props: Record<string, unknown>; radioUrl: string | null }

/** Назва станції: з каталогу за адресою, інакше просто домен. */
function stationName(url: string | null): string {
  if (!url) return "";
  const known = RADIO_STATIONS.find((s) => s.url === url);
  if (known) return known.title;
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function VizWidget({ cls, props, radioUrl }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const mode = vizMode(props.mode);
  const theme = vizTheme(props.theme);
  const sensitivity = vizSensitivity(props.sensitivity);
  const plain = props.card === false;
  const title = String(props.title ?? "Зараз грає");
  const showName = props.showName !== false;
  const name = stationName(radioUrl);

  useEffect(() => {
    const el = canvas.current, holder = box.current;
    if (!el || !holder) return;
    const ctx = el.getContext("2d", { alpha: false });
    if (!ctx) return;
    const mem = createMemory();
    let raf = 0, prev = performance.now(), last = 0, w = 0, h = 0, wasLive = false;

    const fit = () => {
      // полотно рівно під віджет: на ТБ devicePixelRatio нічого не дає, лише вантажить процесор
      const r = holder.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height));
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    };
    fit();

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < FRAME_MS) return;
      last = t;
      const dt = Math.min(0.05, (t - prev) / 1000); prev = t;
      if (el.width !== w || el.height !== h) fit();
      const s = readSpectrum(t);
      if (s.live !== wasLive) { wasLive = s.live; setLive(s.live); }
      paint(ctx, mem, { w, h, dt, now: t / 1000, mode, theme, sensitivity, live: s.live, freq: s.freq, wave: s.wave, sampleRate: s.sampleRate, fftSize: s.fftSize });
    };
    raf = requestAnimationFrame(loop);
    addEventListener("resize", fit);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", fit); };
  }, [mode, theme.id, sensitivity]);

  return <div class={`${cls} w-viz${plain ? " viz-plain" : ""}`}>
    {!plain && <div class="title">
      <span>{title}</span>
      {showName && name && <span class="viz-station">{name}</span>}
    </div>}
    <div class="viz-box" ref={box}>
      <canvas ref={canvas} class="viz-canvas" />
      {plain && showName && name && <div class="viz-tag">{name}</div>}
      {!radioUrl && <div class="viz-note">радіо вимкнене</div>}
      {radioUrl && !live && <div class="viz-note">без спектра</div>}
    </div>
  </div>;
}
