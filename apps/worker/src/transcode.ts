/**
 * ffmpeg: будь-яке відео -> H.264 1080p і 720p без звуку + превʼю jpg; вертикальне чи квадратне (з телефона) -> 16:9
 * з розмитими краями (fillNarrow), а не відмова;
 * фото (jpeg/png/webp) -> jpg 1080p і 720p + превʼю (той самий контракт files/preview).
 * Параметри під старі ТБ-браузери: yuv420p, profile high 4.1, faststart,
 * keyframe кожні 2 с (щоб цикл стартував без провалу), veryfast (2 vCPU / 2 GB).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

const run = promisify(execFile);

export interface ProbeInfo { width: number; height: number; duration: number; fps: number }

export async function probe(input: string): Promise<ProbeInfo> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", input]);
  const j = JSON.parse(stdout);
  const s = j.streams?.[0];
  if (!s) throw new Error("no video stream");
  const [n, d] = String(s.r_frame_rate ?? "25/1").split("/").map(Number);
  return { width: s.width, height: s.height, duration: Number(j.format?.duration ?? 0), fps: d ? n! / d : 25 };
}

/** Кадр вужчий за це (вертикальний чи квадратний, як фото й відео з телефона) — не фон для ТБ «як є». */
const NARROW = 1.3;
const isNarrow = (i: ProbeInfo) => i.width / i.height < NARROW;
/**
 * Вузький кадр -> рівно 16:9 висотою h: сам кадр по центру цілком (нічого не обрізано), по боках — його ж
 * збільшена, розмита й трохи затемнена копія. Так ТБ показує фото з телефона без чорних смуг і без обрізки облич.
 */
export const fillNarrow = (h: number) => {
  const w = Math.round((h * 16) / 9 / 2) * 2;
  return `split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=48:3,eq=brightness=-0.2[bg];` +
    `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
};

export interface TranscodeResult { files: { "1080": string; "720": string }; preview: string; info: ProbeInfo; bytes: Record<string, number> }

/** outBase: шлях без суфікса, напр. /media/bg/<id>. Повертає шляхи відносно mediaRoot. */
export async function transcode(input: string, outBase: string, mediaRoot: string, opts: { maxSeconds?: number } = {}): Promise<TranscodeResult> {
  const info = await probe(input);
  const max = opts.maxSeconds ?? 90;
  if (info.duration > max + 1) throw new Error(`video too long: ${Math.round(info.duration)}s > ${max}s`);
  await mkdir(dirname(outBase), { recursive: true });

  const common = ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-t", String(max), "-an", "-sn",
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0", "-movflags", "+faststart", "-threads", "2"];
  const scale = (h: number) => (isNarrow(info) ? `${fillNarrow(h)},format=yuv420p` : `scale=-2:'min(${h},ih)',pad=ceil(iw/2)*2:ceil(ih/2)*2`);
  await run("ffmpeg", [...common, "-vf", scale(1080), "-crf", "23", "-maxrate", "8M", "-bufsize", "16M", `${outBase}-1080.mp4`], { maxBuffer: 1 << 20 });
  await run("ffmpeg", [...common, "-vf", scale(720), "-crf", "24", "-maxrate", "4M", "-bufsize", "8M", `${outBase}-720.mp4`], { maxBuffer: 1 << 20 });
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(Math.min(1, info.duration / 2)), "-i", `${outBase}-720.mp4`,
    "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", `${outBase}.jpg`]);

  const rel = (p: string) => p.startsWith(mediaRoot) ? p.slice(mediaRoot.length).replace(/^\/+/, "") : p;
  const bytes: Record<string, number> = {};
  for (const s of ["-1080.mp4", "-720.mp4", ".jpg"]) bytes[s] = (await stat(outBase + s)).size;
  return { files: { "1080": rel(`${outBase}-1080.mp4`), "720": rel(`${outBase}-720.mp4`) }, preview: rel(`${outBase}.jpg`), info, bytes };
}

/** Фото: jpg 1080/720 (горизонтальне — без апскейлу, вузьке — 16:9 з розмитими краями) + превʼю 480. Той самий формат результату, що й для відео. */
export async function transcodeImage(input: string, outBase: string, mediaRoot: string): Promise<TranscodeResult> {
  const info = await probe(input);
  await mkdir(dirname(outBase), { recursive: true });
  const common = ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-frames:v", "1", "-pix_fmt", "yuvj420p"];
  const narrow = isNarrow(info);
  const scale = (h: number) => (narrow ? fillNarrow(h) : `scale=-2:'min(${h},ih)'`);
  await run("ffmpeg", [...common, "-vf", scale(1080), "-q:v", "3", `${outBase}-1080.jpg`]);
  await run("ffmpeg", [...common, "-vf", scale(720), "-q:v", "4", `${outBase}-720.jpg`]);
  await run("ffmpeg", [...common, "-vf", narrow ? fillNarrow(270) : "scale=480:-2", "-q:v", "4", `${outBase}.jpg`]);
  const rel = (p: string) => p.startsWith(mediaRoot) ? p.slice(mediaRoot.length).replace(/^\/+/, "") : p;
  const bytes: Record<string, number> = {};
  for (const s of ["-1080.jpg", "-720.jpg", ".jpg"]) bytes[s] = (await stat(outBase + s)).size;
  return { files: { "1080": rel(`${outBase}-1080.jpg`), "720": rel(`${outBase}-720.jpg`) }, preview: rel(`${outBase}.jpg`), info: { ...info, duration: 0 }, bytes };
}

export interface DishResult { file: string; thumb: string; width: number; height: number; bytes: number }

/**
 * Фото страви -> квадрат 1:1 (обрізка по центру) 900 px + мініатюра 300 px.
 * Однаково для AI-фото і для завантаженого власного: меню має виглядати однорідно.
 * alpha: прозоре тло (OpenAI) зберігаємо у webp з альфою, інакше jpg.
 */
export async function dishPhoto(input: string, outBase: string, mediaRoot: string, opts: { alpha?: boolean; side?: number } = {}): Promise<DishResult> {
  const side = opts.side ?? 900;
  await probe(input);
  await mkdir(dirname(outBase), { recursive: true });
  const crop = (px: number) => `crop='min(iw,ih)':'min(iw,ih)',scale=${px}:${px}`;
  const ext = opts.alpha ? "webp" : "jpg";
  const enc = opts.alpha ? ["-c:v", "libwebp", "-pix_fmt", "yuva420p", "-quality", "85"] : ["-pix_fmt", "yuvj420p", "-q:v", "3"];
  const common = ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-frames:v", "1"];
  await run("ffmpeg", [...common, "-vf", crop(side), ...enc, `${outBase}.${ext}`]);
  await run("ffmpeg", [...common, "-vf", crop(300), ...enc, `${outBase}-t.${ext}`]);
  const rel = (p: string) => (p.startsWith(mediaRoot) ? p.slice(mediaRoot.length).replace(/^\/+/, "") : p);
  return {
    file: rel(`${outBase}.${ext}`), thumb: rel(`${outBase}-t.${ext}`),
    width: side, height: side, bytes: (await stat(`${outBase}.${ext}`)).size,
  };
}
