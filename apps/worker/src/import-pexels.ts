/**
 * Стандартні фони з Pexels (Pexels License: комерційне використання дозволене,
 * атрибуція не обовʼязкова, але зберігаємо автора). Один раз при розгортанні або
 * коли треба поповнити бібліотеку: pnpm --filter @deye/worker import-pexels
 */
import postgres from "postgres";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const KEY = process.env.PEXELS_API_KEY;
if (!KEY) throw new Error("PEXELS_API_KEY is required");
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/media";
const sql = postgres(process.env.DATABASE_URL ?? "postgres://deye:deye@localhost:5432/deye", { max: 2, onnotice: () => {} });

// категорія -> запити; беремо по `take` відео на запит
const PLAN: { category: string; query: string; take: number }[] = [
  { category: "Вогонь", query: "fireplace burning logs close up", take: 3 },
  { category: "Вогонь", query: "campfire night", take: 2 },
  { category: "Затишок", query: "candles flame dark", take: 2 },
  { category: "Затишок", query: "coffee steam cup", take: 2 },
  { category: "Зима", query: "snow falling trees", take: 2 },
  { category: "Місто", query: "city night lights bokeh", take: 2 },
  { category: "Вода", query: "waterfall", take: 3 },
  { category: "Вода", query: "ocean waves beach", take: 2 },
  { category: "Акваріум", query: "aquarium fish", take: 3 },
  { category: "Природа", query: "forest sunlight", take: 2 },
  { category: "Природа", query: "rain on window", take: 2 },
  { category: "Небо", query: "clouds timelapse", take: 2 },
  { category: "Небо", query: "night sky stars", take: 2 },
  { category: "Абстракція", query: "abstract particles background", take: 2 },
];
const MIN_S = 10, MAX_S = 60;
// відбраковані вручну (дублікати, чорні кадри) — не імпортувати знову
const SKIP = new Set((await import("./pexels-skip.json", { with: { type: "json" } })).default as string[]);

interface PexelsVideo { id: number; width: number; height: number; duration: number; url: string; user: { name: string; url: string }; video_files: { file_type: string; width: number; height: number; fps: number; link: string }[] }

async function search(query: string): Promise<PexelsVideo[]> {
  const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=landscape&size=medium&per_page=15`,
    { headers: { Authorization: KEY!, "User-Agent": "Mozilla/5.0 deye-dashboard" } });
  if (!r.ok) throw new Error(`pexels ${r.status}`);
  return ((await r.json()) as { videos: PexelsVideo[] }).videos;
}

function bestFile(v: PexelsVideo) {
  const f = v.video_files.filter((x) => x.file_type === "video/mp4" && x.height && x.height <= 1080 && x.width > x.height);
  return f.sort((a, b) => b.height - a.height)[0];
}

const rows = await sql`select source, name from backgrounds where org_id is null`;
const existing = new Set(rows.map((r) => r.source as string));
// скільки вже є на цей запит (імʼя = "Категорія: запит #n"), щоб не набирати повторно
const countFor = (category: string, query: string) => rows.filter((r) => String(r.name).startsWith(`${category}: ${query} #`)).length;
await mkdir(join(MEDIA_ROOT, "src"), { recursive: true });
let added = 0;
for (const p of PLAN) {
  let taken = countFor(p.category, p.query);
  if (taken >= p.take) continue;
  for (const v of await search(p.query)) {
    if (taken >= p.take) break;
    if (existing.has(v.url) || v.duration < MIN_S || v.duration > MAX_S || v.width < v.height) continue;
    if (SKIP.has(v.url)) continue;
    const f = bestFile(v);
    if (!f || f.height < 720) continue;
    const srcRel = `src/pexels-${v.id}.mp4`;
    const r = await fetch(f.link, { headers: { "User-Agent": "Mozilla/5.0 deye-dashboard" } });
    if (!r.ok || !r.body) { console.log("download failed", v.id, r.status); continue; }
    await pipeline(Readable.fromWeb(r.body as never), createWriteStream(join(MEDIA_ROOT, srcRel)));
    const name = `${p.category}: ${p.query} #${taken + 1}`;
    await sql.begin(async (tx) => {
      const [bg] = await tx`insert into backgrounds (org_id, name, category, license, source, attribution, status, source_file)
        values (null, ${name}, ${p.category}, 'Pexels License', ${v.url}, ${`${v.user.name} / Pexels`}, 'uploaded', ${srcRel}) returning id`;
      await tx`insert into transcode_jobs (background_id) values (${bg!.id})`;
    });
    existing.add(v.url); taken++; added++;
    console.log(`queued ${name} (${f.width}x${f.height}, ${v.duration}s, by ${v.user.name})`);
  }
}
console.log(`done: ${added} backgrounds queued`);
await sql.end();
