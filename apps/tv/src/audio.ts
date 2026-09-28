/**
 * Один AnalyserNode на сторінку: його наповнює елемент радіо з app.tsx, а читає віджет спектра.
 *
 * Через Web Audio звук іде лише тоді, коли віджет спектра справді є на екрані — createMediaElementSource
 * перехоплює вихід елемента назавжди, і зайвий раз лізти в цей ланцюг на телевізорі не варто.
 * Якщо щось із Web Audio не вийшло, радіо грає як раніше, просто без спектра.
 */
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
let freq = new Uint8Array(0);
let wave = new Uint8Array(0);
/** коли востаннє бачили ненульовий сигнал: тиша (зокрема від cross-origin) не має вдавати живий спектр */
let lastSignal = 0;

type Ctor = typeof AudioContext;
const audioCtor = (): Ctor | null =>
  (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext) ?? null;

/** Пропустити елемент радіо через аналізатор. true — спектр доступний. */
export function attachSpectrum(el: HTMLAudioElement): boolean {
  if (source) return true;
  const Ctor = audioCtor();
  if (!Ctor) return false;
  try {
    const c = new Ctor();
    const a = c.createAnalyser();
    a.fftSize = 1024;                 // 512 смуг вистачає, а рахувати вдвічі дешевше, ніж 2048
    a.smoothingTimeConstant = 0.72;
    a.minDecibels = -90;
    a.maxDecibels = -18;
    const src = c.createMediaElementSource(el);
    src.connect(a);
    a.connect(c.destination);         // без цього радіо замовкне: вихід елемента вже перехоплено
    ctx = c; analyser = a; source = src;
    freq = new Uint8Array(a.frequencyBinCount);
    wave = new Uint8Array(a.fftSize);
    return true;
  } catch {
    ctx = null; analyser = null; source = null;
    return false;
  }
}

/** Автозапуск звуку заборонено, доки не буде жесту — кликати на тому самому жесті, що й play(). */
export function resumeSpectrum(): void {
  if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
}

export interface Spectrum { live: boolean; freq: Uint8Array | null; wave: Uint8Array | null; sampleRate: number; fftSize: number }

/**
 * Поточний кадр спектра. live = false, якщо аналізатора немає або в ньому тиша довше за секунду:
 * так екран сам переходить на плавну анімацію замість мертвих нулів.
 */
export function readSpectrum(now: number): Spectrum {
  if (!analyser) return { live: false, freq: null, wave: null, sampleRate: 48000, fftSize: 1024 };
  analyser.getByteFrequencyData(freq);
  analyser.getByteTimeDomainData(wave);
  let peak = 0;
  for (let i = 0; i < freq.length; i += 4) if (freq[i]! > peak) peak = freq[i]!;
  if (peak > 2) lastSignal = now;
  return { live: now - lastSignal < 1000, freq, wave, sampleRate: ctx?.sampleRate ?? 48000, fftSize: analyser.fftSize };
}
