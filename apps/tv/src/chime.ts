/**
 * Звуки сповіщень, синтезовані Web Audio: жодних файлів і жодного медіаелемента. На Samsung Tizen
 * дозволено лише один <video>/<audio> — сигнал через нього поставив би на паузу радіо чи відеофон,
 * а осцилятор їх не чіпає.
 *
 * Браузер не дає звуку без жесту користувача: контекст стартує «suspended» і оживає на першій
 * кнопці пульта. У застосунку для Android TV жест не потрібен (mediaPlaybackRequiresUserGesture = false).
 */
import type { AlertKind } from "@deye/shared/alerts";

let ctx: AudioContext | null = null;

type Ctor = typeof AudioContext;
const audioCtor = (): Ctor | null =>
  (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext) ?? null;

/** Спільний контекст сигналів і голосових сповіщень (voice.ts): розблоковується одним жестом. */
export function context(): AudioContext | null {
  if (ctx) return ctx;
  const C = audioCtor();
  if (!C) return null;
  try { ctx = new C(); } catch { return null; }
  return ctx;
}

/** Викликати на жесті (кнопка пульта): після цього звук дозволений до кінця сесії. */
export function unlockChimes(): void {
  const c = context();
  if (c?.state === "suspended") void c.resume().catch(() => {});
}

/** Чи зможе сигнал прозвучати просто зараз. */
export const chimesReady = (): boolean => context()?.state === "running";

/** [частота Гц, початок с, тривалість с] — кожна подія впізнавана на слух без погляду на екран. */
const PATTERNS: Record<AlertKind, { wave: OscillatorType; notes: [number, number, number][] }> = {
  // спадна тріада двічі: «щось вимкнулось»
  grid_down: { wave: "triangle", notes: [[880, 0, 0.28], [698, 0.3, 0.28], [523, 0.6, 0.5], [880, 1.3, 0.28], [698, 1.6, 0.28], [523, 1.9, 0.6]] },
  // висхідна: «повернулось»
  grid_up: { wave: "sine", notes: [[523, 0, 0.22], [659, 0.22, 0.22], [784, 0.44, 0.22], [1047, 0.66, 0.6]] },
  // три короткі тривожні гудки двічі
  soc_low: { wave: "square", notes: [[988, 0, 0.14], [988, 0.25, 0.14], [988, 0.5, 0.14], [988, 1.1, 0.14], [988, 1.35, 0.14], [988, 1.6, 0.14]] },
  // швидкий яскравий арпеджіо
  pv_high: { wave: "sine", notes: [[784, 0, 0.14], [988, 0.12, 0.14], [1175, 0.24, 0.14], [1568, 0.36, 0.5]] },
  // тривога (запасний сигнал, коли голос не завантажився): сирена, що повторюється
  air_alert: { wave: "sawtooth", notes: [[660, 0, 0.45], [880, 0.45, 0.45], [660, 0.9, 0.45], [880, 1.35, 0.45], [660, 1.8, 0.45], [880, 2.25, 0.6]] },
  // відбій: два спокійні тони вгору
  air_clear: { wave: "sine", notes: [[523, 0, 0.35], [784, 0.4, 0.7]] },
};

/** Програти сигнал події. Повертає тривалість у мс (щоб на цей час притишити радіо) або 0, якщо звуку не буде. */
export function playChime(kind: AlertKind, volume: number): number {
  const c = context();
  if (!c || c.state !== "running" || volume <= 0) return 0;
  const { wave, notes } = PATTERNS[kind];
  // квадратна хвиля суб'єктивно втричі гучніша за синус — вирівнюємо
  const peak = Math.min(1, volume) * (wave === "square" || wave === "sawtooth" ? 0.12 : 0.35);
  const t0 = c.currentTime + 0.05;
  let end = 0;
  for (const [freq, at, dur] of notes) {
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    const s = t0 + at;
    gain.gain.setValueAtTime(0, s);
    gain.gain.linearRampToValueAtTime(peak, s + 0.015);          // без клацання на старті
    gain.gain.setValueAtTime(peak, s + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, s + dur);     // м'яке згасання
    osc.connect(gain).connect(c.destination);
    osc.start(s);
    osc.stop(s + dur + 0.02);
    end = Math.max(end, at + dur);
  }
  return Math.round((end + 0.1) * 1000);
}
