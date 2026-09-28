/**
 * Малювання візуалізації звуку на canvas. Порт ідеї з прототипу, підрізаний під телевізор:
 * без тіней і зайвих градієнтів на кадр, полотно — розміром віджета, а не екрана.
 * Коли живого спектра немає (станція без CORS і без проксі, або радіо мовчить), рівні
 * бере idleLevel — плавна «дихаюча» хвиля, щоб картинка не завмирала.
 */
import { mix, rgba, type VizMode, type VizTheme } from "@deye/shared/spectrum";

const ATTACK = 0.46, RELEASE = 0.07;

export interface VizMemory { levels: Float32Array; peaks: Float32Array; bass: number; spin: number }
export const createMemory = (): VizMemory => ({ levels: new Float32Array(48), peaks: new Float32Array(48), bass: 0, spin: 0 });

export interface PaintInput {
  w: number; h: number; dt: number; now: number;
  mode: VizMode; theme: VizTheme; sensitivity: number;
  /** є справжні дані аналізатора */
  live: boolean;
  freq: Uint8Array | null; wave: Uint8Array | null;
  sampleRate: number; fftSize: number;
}

/** Смуг тим більше, чим ширший віджет; на ТБ дрібніше 2-3 px однаково не видно. */
function binCount(mode: VizMode, w: number, h: number): number {
  if (mode === "orbit") return 64;
  if (mode === "circle") return Math.round(Math.min(96, Math.max(40, Math.min(w, h) / 7)));
  return Math.round(Math.min(72, Math.max(20, w / 16)));
}

function resize(mem: VizMemory, count: number): void {
  if (mem.levels.length === count) return;
  const levels = new Float32Array(count), peaks = new Float32Array(count);
  const prev = Math.max(1, mem.levels.length);
  for (let i = 0; i < count; i++) {
    const j = Math.min(prev - 1, Math.floor((i / count) * prev));
    levels[i] = mem.levels[j] ?? 0; peaks[i] = mem.peaks[j] ?? 0;
  }
  mem.levels = levels; mem.peaks = peaks;
}

/** Рівень без звуку: дві синусоїди + «вдих», щоб не було видно періоду. */
function idleLevel(i: number, n: number, now: number): number {
  const u = i / n;
  const wave = 0.16 + 0.11 * Math.sin(now * 0.85 + u * Math.PI * 4) + 0.07 * Math.sin(now * 1.55 + u * Math.PI * 8);
  const breath = Math.pow(Math.max(0, Math.sin(now * 1.35)), 6) * 0.22;
  return Math.max(0.03, wave + breath * (0.4 + 0.6 * Math.sin(u * Math.PI * 2)));
}

/** Енергія смуги i з n у логарифмічній шкалі частот (як чує вухо, а не як лежить FFT). */
function bandEnergy(freq: Uint8Array, sampleRate: number, fftSize: number, i: number, n: number): number {
  const minF = 36, maxF = Math.min(15000, sampleRate * 0.46);
  const f0 = minF * Math.pow(maxF / minF, i / n), f1 = minF * Math.pow(maxF / minF, (i + 1) / n);
  const b0 = Math.max(1, Math.floor((f0 * fftSize) / sampleRate));
  const b1 = Math.min(freq.length - 1, Math.max(b0 + 1, Math.ceil((f1 * fftSize) / sampleRate)));
  let sum = 0, count = 0;
  for (let b = b0; b <= b1; b++) { sum += freq[b] ?? 0; count++; }
  return count ? sum / count / 255 : 0;
}

function bassEnergy(freq: Uint8Array, sampleRate: number, fftSize: number): number {
  const b0 = Math.max(1, Math.floor((42 * fftSize) / sampleRate));
  const end = Math.min(freq.length - 1, Math.max(b0 + 1, Math.floor((140 * fftSize) / sampleRate)));
  let sum = 0, count = 0;
  for (let b = b0; b <= end; b++) { sum += freq[b] ?? 0; count++; }
  return count ? sum / count / 255 : 0;
}

/** Швидко вгору, повільно вниз — інакше смуги смикаються. */
const approach = (cur: number, target: number) => cur + (target - cur) * (target > cur ? ATTACK : RELEASE);

function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number, theme: VizTheme, bass: number) {
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h * 0.46, radius = Math.max(w, h) * (0.42 + bass * 0.1);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  glow.addColorStop(0, rgba(theme.a, 0.16 + bass * 0.28));
  glow.addColorStop(0.42, rgba(theme.b, 0.05));
  glow.addColorStop(1, rgba(theme.a, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
}

function roundBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (h < 0.5 || w < 0.5) return;
  const r = Math.min(w / 2, 10, h / 2);
  // roundRect є не в усіх ТБ-браузерах
  if (typeof ctx.roundRect === "function") { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
  else ctx.fillRect(x, y, w, h);
}

function paintBars(ctx: CanvasRenderingContext2D, w: number, h: number, theme: VizTheme, levels: Float32Array, peaks: Float32Array, mirrored: boolean) {
  const n = levels.length;
  const gap = Math.max(2, w * 0.0035), margin = Math.max(10, w * 0.04);
  const bw = Math.max(2, (w - margin * 2 - gap * (n - 1)) / n);
  const total = n * bw + (n - 1) * gap;
  let x = (w - total) / 2;
  // у картці віджета сенсу лишати третину порожньою немає: стовпці стоять майже на дні й ростуть майже на всю висоту
  const mid = h * 0.5, base = h * 0.93, maxH = h * (mirrored ? 0.42 : 0.8);

  const top = mirrored ? mid - maxH : base - maxH, bottom = mirrored ? mid + maxH : base;
  const grad = ctx.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, rgba(theme.b, 0.95));
  grad.addColorStop(0.55, rgba(mix(theme.a, theme.b, 0.45), 0.92));
  grad.addColorStop(1, rgba(theme.a, 0.9));
  const peakColor = rgba(mix(theme.b, [255, 250, 245], 0.35), 0.9);
  ctx.fillStyle = grad;

  if (mirrored) {
    ctx.beginPath(); ctx.moveTo(x, mid); ctx.lineTo(x + total, mid);
    ctx.strokeStyle = rgba(theme.b, 0.28); ctx.lineWidth = 1; ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    const v = levels[i] ?? 0, pk = peaks[i] ?? 0;
    const bh = Math.max(bw * 0.65, v * maxH);
    if (mirrored) {
      roundBar(ctx, x, mid - bh, bw, bh);
      ctx.globalAlpha = 0.72; roundBar(ctx, x, mid + 2, bw, bh * 0.92); ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(theme.b, 0.9);
      ctx.fillRect(x, mid - Math.max(bh, pk * maxH) - 5, bw, Math.max(2, bw * 0.22));
    } else {
      roundBar(ctx, x, base - bh, bw, bh);
      ctx.globalAlpha = 0.2; roundBar(ctx, x, base + 4, bw, bh * 0.4); ctx.globalAlpha = 1;
      ctx.fillStyle = peakColor;
      ctx.fillRect(x, base - pk * maxH - 6, bw, Math.max(2, bw * 0.22));
    }
    ctx.fillStyle = grad;
    x += bw + gap;
  }
}

function paintCircle(ctx: CanvasRenderingContext2D, w: number, h: number, theme: VizTheme, levels: Float32Array, bass: number, spin: number, wave: Uint8Array | null, live: boolean, now: number) {
  const n = levels.length, cx = w / 2, cy = h * 0.48;
  const radius = Math.min(w, h) * 0.2 * (1 + bass * 0.06), reach = Math.min(w, h) * 0.22;
  const core = ctx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius);
  core.addColorStop(0, rgba(theme.b, 0.42 + bass * 0.35));
  core.addColorStop(0.55, rgba(theme.a, 0.14));
  core.addColorStop(1, rgba(theme.a, 0));
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(theme.b, 0.4); ctx.lineWidth = 1.25; ctx.stroke();

  ctx.lineCap = "round";
  const thickness = Math.max(2.2, ((Math.PI * 2 * radius) / n) * 0.42);
  for (let i = 0; i < n; i++) {
    const ang = spin + (i / n) * Math.PI * 2, v = levels[i] ?? 0;
    const inner = radius + 8, cos = Math.cos(ang), sin = Math.sin(ang);
    ctx.strokeStyle = rgba(mix(theme.a, theme.b, 0.25 + v * 0.75), 0.4 + v * 0.6);
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(cx + cos * inner, cy + sin * inner);
    ctx.lineTo(cx + cos * (inner + 3 + v * reach), cy + sin * (inner + 3 + v * reach));
    ctx.stroke();
  }

  // осцилограма всередині кола: справжня хвиля, якщо вона є
  ctx.beginPath();
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const ang = (i / steps) * Math.PI * 2 + spin * 0.25;
    let amp = Math.sin(now * 1.2 + ang * 3) * 0.08;
    if (live && wave && wave.length) amp = (((wave[Math.floor((i / steps) * (wave.length - 1))] ?? 128) - 128) / 128) * 0.22;
    const r = radius * (0.62 + amp);
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = rgba(theme.b, 0.7); ctx.lineWidth = 1.35; ctx.stroke();
}

function paintOrbit(ctx: CanvasRenderingContext2D, w: number, h: number, theme: VizTheme, levels: Float32Array, bass: number, spin: number) {
  const cx = w / 2, cy = h * 0.48, n = levels.length;
  const minSide = Math.min(w, h), rings = 4, gap = minSide * 0.062, base0 = minSide * 0.11;

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, base0 * 1.4);
  core.addColorStop(0, rgba(theme.b, 0.55 + bass * 0.35));
  core.addColorStop(1, rgba(theme.a, 0));
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(cx, cy, base0 * (0.72 + bass * 0.2), 0, Math.PI * 2); ctx.fill();

  for (let ring = 0; ring < rings; ring++) {
    const base = base0 + ring * gap, amp = minSide * (0.018 + ring * 0.008);
    const turn = spin * (0.55 + ring * 0.22) * (ring % 2 === 0 ? 1 : -1);
    const color = mix(theme.a, theme.b, ring / (rings - 1));
    ctx.beginPath();
    const steps = 110;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps, idx = u * n, i0 = Math.floor(idx) % n, i1 = (i0 + 1) % n, frac = idx - Math.floor(idx);
      const level = (levels[i0] ?? 0) * (1 - frac) + (levels[i1] ?? 0) * frac;
      const ang = u * Math.PI * 2 + turn, rad = base + level * amp * 3.2;
      const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad * 0.94;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(color, 0.28 + ring * 0.08);
    ctx.lineWidth = ring === rings - 1 ? 1.75 : 1.15;
    ctx.stroke();

    const beads = 10 + ring * 2;
    for (let b = 0; b < beads; b++) {
      const u = b / beads, level = levels[Math.floor(u * n) % n] ?? 0;
      const ang = u * Math.PI * 2 + turn, rad = base + level * amp * 3.2;
      ctx.fillStyle = rgba(theme.b, 0.25 + level * 0.7);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.94, 1.4 + level * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = rgba(theme.b, 0.85); ctx.lineWidth = 2.25;
  ctx.beginPath(); ctx.arc(cx, cy, base0 + gap * 1.5, spin * 1.6, spin * 1.6 + 0.7); ctx.stroke();
}

export function paint(ctx: CanvasRenderingContext2D, mem: VizMemory, input: PaintInput): void {
  resize(mem, binCount(input.mode, input.w, input.h));
  const n = mem.levels.length;
  const dt = Math.min(0.05, Math.max(0.001, input.dt));
  const hasFreq = input.live && !!input.freq;

  for (let i = 0; i < n; i++) {
    let target: number;
    if (hasFreq) {
      const energy = bandEnergy(input.freq!, input.sampleRate, input.fftSize, i, n);
      target = Math.min(1, Math.pow(energy, 0.62) * input.sensitivity * (0.82 + 0.45 * (i / n)));
    } else {
      target = idleLevel(i, n, input.now);
    }
    const next = approach(mem.levels[i] ?? 0, target);
    mem.levels[i] = next;
    const peak = mem.peaks[i] ?? 0;
    mem.peaks[i] = next >= peak ? next : peak * Math.pow(0.985, dt * 60);
  }

  const bassTarget = hasFreq
    ? Math.min(1, Math.pow(bassEnergy(input.freq!, input.sampleRate, input.fftSize), 0.7) * input.sensitivity)
    : 0.12 + 0.08 * Math.sin(input.now * 0.8);
  mem.bass = approach(mem.bass, bassTarget);
  mem.spin += dt * (0.11 + mem.bass * 0.28);

  backdrop(ctx, input.w, input.h, input.theme, mem.bass);
  if (input.mode === "bars" || input.mode === "mirror") paintBars(ctx, input.w, input.h, input.theme, mem.levels, mem.peaks, input.mode === "mirror");
  else if (input.mode === "circle") paintCircle(ctx, input.w, input.h, input.theme, mem.levels, mem.bass, mem.spin, input.wave, input.live, input.now);
  else paintOrbit(ctx, input.w, input.h, input.theme, mem.levels, mem.bass, mem.spin);
}
