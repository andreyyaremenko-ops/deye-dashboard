/**
 * Голосові сповіщення (голос «Kateryna», ElevenLabs): короткі MP3 у public/sounds, програються через Web
 * Audio — той самий контекст, що й сигнали chime.ts, тому на Tizen не зупиняють радіо чи відеофон і
 * розблоковуються тим самим жестом. Файл, що не завантажився, не мовчить: замість нього звучить сигнал.
 */
import type { AlertEvent } from "@deye/shared/alerts";
import { context } from "./chime.ts";

const BASE = `${import.meta.env.BASE_URL}sounds/`;

/** Фрази події по черзі; для тривоги друга фраза — рівень загрози. soc_low голосу не має (лише сигнал). */
export function voiceClips(ev: AlertEvent): string[] {
  switch (ev.kind) {
    case "air_alert":
      return ["uvaha-povitriana-tryvoha", ...(ev.level === "red" ? ["raketna-nebezpeka"] : ev.level === "yellow" ? ["dronova-zahroza"] : [])];
    case "air_clear": return ["vidbii-tryvohy"];
    case "grid_down": return ["svitlo-znyklo-ekonomte-batareiu"];
    case "grid_up": return ["svitlo-daly-topit-varit-hriites"];
    case "pv_high": return ["yibat-heneratsiia-yibieisha"];
    default: return [];
  }
}

const buffers = new Map<string, Promise<AudioBuffer | null>>();

function load(c: AudioContext, name: string): Promise<AudioBuffer | null> {
  let p = buffers.get(name);
  if (!p) {
    p = fetch(`${BASE}${name}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      // форма з колбеками: проміс decodeAudioData є лише з Chromium 49, а ТБ бувають старші
      .then((data) => new Promise<AudioBuffer | null>((ok) => c.decodeAudioData(data, ok, () => ok(null))))
      .catch(() => null);
    buffers.set(name, p);
    void p.then((b) => { if (!b) buffers.delete(name); });   // невдачу спробуємо ще раз наступного разу
  }
  return p;
}

/** Завантажити всі фрази заздалегідь, щоб у момент події голос пролунав без затримки на мережу. */
export function preloadVoices(): void {
  const c = context();
  if (!c) return;
  const all = new Set<string>();
  for (const kind of ["air_alert", "air_clear", "grid_down", "grid_up", "pv_high"] as const) {
    for (const n of voiceClips({ kind, text: "", level: "red" })) all.add(n);
    for (const n of voiceClips({ kind, text: "", level: "yellow" })) all.add(n);
  }
  for (const n of all) void load(c, n);
}

/** Програти фрази одну за одною. Повертає тривалість у мс або 0, якщо голосу не буде (тоді — сигнал). */
export async function playVoice(names: string[], volume: number): Promise<number> {
  const c = context();
  if (!c || c.state !== "running" || volume <= 0 || !names.length) return 0;
  const bufs = await Promise.all(names.map((n) => load(c, n)));
  if (bufs.some((b) => !b)) return 0;
  const gain = c.createGain();
  gain.gain.value = Math.min(1, volume);
  gain.connect(c.destination);
  let at = c.currentTime + 0.05;
  const PAUSE = 0.25;
  for (const b of bufs as AudioBuffer[]) {
    const src = c.createBufferSource();
    src.buffer = b;
    src.connect(gain);
    src.start(at);
    at += b.duration + PAUSE;
  }
  return Math.round((at - c.currentTime) * 1000);
}
