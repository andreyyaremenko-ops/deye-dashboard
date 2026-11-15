import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe, transcode, transcodeImage } from "../src/transcode.ts";

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
  it("вертикальне відео (з телефона) -> 16:9 з розмитими краями", async () => {
    const v = join(dir, "vert.mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=25", "-t", "1", "-pix_fmt", "yuv420p", v]);
    const r = await transcode(v, join(dir, "bg", "v"), dir);
    const p1080 = await probe(join(dir, r.files["1080"]));
    expect([p1080.width, p1080.height]).toEqual([1920, 1080]);
    const p720 = await probe(join(dir, r.files["720"]));
    expect([p720.width, p720.height]).toEqual([1280, 720]);
  }, 60_000);
});

describe("transcodeImage", () => {
  it("робить jpg 1080 (не апскейлить), 720 і превʼю з png", async () => {
    const png = join(dir, "photo.png");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1600x900", "-frames:v", "1", png]);
    const r = await transcodeImage(png, join(dir, "bg", "p"), dir);
    expect(r.files).toEqual({ "1080": "bg/p-1080.jpg", "720": "bg/p-720.jpg" });
    expect(r.preview).toBe("bg/p.jpg");
    expect(r.info.duration).toBe(0);
    expect((await probe(join(dir, r.files["1080"]))).height).toBe(900); // джерело 900px: не збільшуємо
    expect((await probe(join(dir, r.files["720"]))).width).toBe(1280);
    expect((await probe(join(dir, r.preview))).width).toBe(480);
    expect(r.bytes["-1080.jpg"]).toBeGreaterThan(1000);
  });
  it("вертикальне й квадратне фото -> 16:9 з розмитими краями", async () => {
    for (const [name, size] of [["vert.jpg", "900x1600"], ["square.jpg", "1200x1200"]] as const) {
      const v = join(dir, name);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=size=${size}`, "-frames:v", "1", v]);
      const r = await transcodeImage(v, join(dir, "bg", name), dir);
      const p1080 = await probe(join(dir, r.files["1080"]));
      expect([p1080.width, p1080.height]).toEqual([1920, 1080]);
      expect([(await probe(join(dir, r.files["720"]))).width, (await probe(join(dir, r.preview))).width]).toEqual([1280, 480]);
    }
  });
});
