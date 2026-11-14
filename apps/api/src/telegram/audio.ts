/**
 * Голосові з Telegram (OGG/Opus) -> MP3 для телевізорів: старі Tizen не декодують Opus у Web Audio.
 * Моно 96 кбіт/с і вирівнювання гучності (loudnorm, один прохід): тихий запис з телефона в залі має бути чутно.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type AudioConverter = (input: Buffer) => Promise<Buffer>;

export const ffmpegToMp3: AudioConverter = (input) => new Promise((ok, fail) => {
  const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "44100",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-b:a", "96k", "-f", "mp3", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
  const out: Buffer[] = []; let err = "";
  const timer = setTimeout(() => p.kill("SIGKILL"), 60_000);
  p.stdout.on("data", (d: Buffer) => out.push(d));
  p.stderr.on("data", (d: Buffer) => { err += d.toString(); });
  p.on("error", (e) => { clearTimeout(timer); fail(e); });
  p.on("close", (code) => { clearTimeout(timer); if (code === 0 && out.length) ok(Buffer.concat(out)); else fail(new Error(`ffmpeg ${code}: ${err.slice(0, 300)}`)); });
  p.stdin.on("error", () => {});   // ffmpeg міг закритись раніше — помилку дасть close
  p.stdin.end(input);
});

/** Голосові живуть добу: телевізори програють їх одразу, архіву не потрібно. */
const VOICE_TTL_MS = 24 * 3600_000;

/** Зберегти mp3 у /media/voice; заодно прибрати старі. Повертає шлях відносно MEDIA_ROOT. */
export async function saveVoice(mediaRoot: string, id: string, mp3: Buffer): Promise<string> {
  const dir = join(mediaRoot, "voice");
  await mkdir(dir, { recursive: true });
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const full = join(dir, f);
    const st = await stat(full).catch(() => null);
    if (st && Date.now() - st.mtimeMs > VOICE_TTL_MS) await unlink(full).catch(() => {});
  }
  await writeFile(join(dir, `${id}.mp3`), mp3);
  return `voice/${id}.mp3`;
}
