import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe, transcode } from "../src/transcode.ts";

const dir = mkdtempSync(join(tmpdir(), "deye-tc-"));
const src = join(dir, "src.mp4");

beforeAll(() => {
  // 3 с синтетичного відео 1280x720 зі звуком — звук має зникнути, розміри масштабуватись
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25", "-f", "lavfi", "-i", "sine=frequency=440",
    "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
});

describe("transcode", () => {
  it("probe читає розміри й тривалість", async () => {
    const i = await probe(src);
    expect(i.width).toBe(1280); expect(i.height).toBe(720); expect(i.duration).toBeCloseTo(3, 0);
  });
  it("робить 1080 (не апскейлить), 720 і превʼю, без аудіо", async () => {
    const r = await transcode(src, join(dir, "bg", "x"), dir);
    expect(r.files).toEqual({ "1080": "bg/x-1080.mp4", "720": "bg/x-720.mp4" });
    expect(r.preview).toBe("bg/x.jpg");
    const p1080 = await probe(join(dir, r.files["1080"]));
    expect(p1080.height).toBe(720); // джерело 720p: не збільшуємо
    const p720 = await probe(join(dir, r.files["720"]));
    expect(p720.width).toBe(1280);
    const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", join(dir, r.files["1080"])]).toString();
    expect(streams.trim().split("\n")).toEqual(["video"]);
    expect(r.bytes[".jpg"]).toBeGreaterThan(1000);
  }, 60_000);
  it("відхиляє вертикальне відео", async () => {
    const v = join(dir, "vert.mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=25", "-t", "1", "-pix_fmt", "yuv420p", v]);
    await expect(transcode(v, join(dir, "bg", "v"), dir)).rejects.toThrow(/vertical/);
  });
});
