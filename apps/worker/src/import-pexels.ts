/**
 * Стандартні фони з Pexels (Pexels License: комерційне використання дозволене,
 * атрибуція не обовʼязкова, але зберігаємо автора). Один раз при розгортанні або
 * коли треба поповнити бібліотеку: pnpm --filter @deye/worker import-pexels
 * Лише статичні фото (без пошуку нових відео): ... import-pexels photos
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
// title — людська назва в бібліотеці ("Камін 1", "Камін 2"...)
const PLAN: { category: string; query: string; title: string; take: number }[] = [
  { category: "Вогонь", query: "fireplace burning logs close up", title: "Камін", take: 3 },
  { category: "Вогонь", query: "campfire night", title: "Багаття", take: 2 },
  { category: "Затишок", query: "candles flame dark", title: "Свічки", take: 2 },
  { category: "Затишок", query: "coffee steam cup", title: "Кава", take: 2 },
  { category: "Зима", query: "snow falling trees", title: "Сніг", take: 2 },
  { category: "Місто", query: "city night lights bokeh", title: "Нічне місто", take: 2 },
  { category: "Вода", query: "waterfall", title: "Водоспад", take: 3 },
  { category: "Вода", query: "ocean waves beach", title: "Море", take: 2 },
  { category: "Акваріум", query: "aquarium fish", title: "Акваріум", take: 3 },
  { category: "Природа", query: "forest sunlight", title: "Ліс", take: 2 },
  { category: "Природа", query: "rain on window", title: "Дощ за вікном", take: 2 },
  { category: "Небо", query: "clouds timelapse", title: "Хмари", take: 2 },
  { category: "Небо", query: "night sky stars", title: "Зоряне небо", take: 1 },
  { category: "Абстракція", query: "abstract particles background", title: "Частинки", take: 2 },
];
const MIN_S = 10, MAX_S = 60;
// відбраковані вручну (дублікати, чорні кадри) — не імпортувати знову
const SKIP = new Set((await import("./pexels-skip.json", { with: { type: "json" } })).default as string[]);

// Статичні фони: відібрані вручну з пошуку Pexels (темні/спокійні — віджети читаються), тому стабільні id, а не перший результат
const PHOTOS: { id: number; title: string }[] = [
  { id: 35105460, title: "Сонячна станція" }, { id: 849403, title: "Соняшники" }, { id: 33135622, title: "Пшениця" },
  { id: 31612225, title: "Ліс у тумані" }, { id: 11605701, title: "Гори на світанку" }, { id: 18833053, title: "Зоряне небо" },
  { id: 18834566, title: "Нічне місто" }, { id: 16556498, title: "Кава" }, { id: 12932215, title: "Темне дерево" },
  { id: 7135037, title: "Градієнт" },
];
const PHOTO_CATEGORY = "Фото";
const onlyPhotos = process.argv[2] === "photos";

interface PexelsPhoto { id: number; width: number; height: number; url: string; photographer: string; src: { original: string } }
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
const countFor = (title: string) => rows.filter((r) => /^(.+) \d+$/.exec(String(r.name))?.[1] === title).length;
await mkdir(join(MEDIA_ROOT, "src"), { recursive: true });
let added = 0;
for (const p of onlyPhotos ? [] : PLAN) {
  let taken = countFor(p.title);
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
    const name = `${p.title} ${taken + 1}`;
    await sql.begin(async (tx) => {
      const [bg] = await tx`insert into backgrounds (org_id, name, category, license, source, attribution, status, source_file)
        values (null, ${name}, ${p.category}, 'Pexels License', ${v.url}, ${`${v.user.name} / Pexels`}, 'uploaded', ${srcRel}) returning id`;
      await tx`insert into transcode_jobs (background_id) values (${bg!.id})`;
    });
    existing.add(v.url); taken++; added++;
    console.log(`queued ${name} (${f.width}x${f.height}, ${v.duration}s, by ${v.user.name})`);
  }
}
for (const ph of PHOTOS) {
  const r = await fetch(`https://api.pexels.com/v1/photos/${ph.id}`, { headers: { Authorization: KEY!, "User-Agent": "Mozilla/5.0 deye-dashboard" } });
  if (!r.ok) { console.log("photo lookup failed", ph.id, r.status); continue; }
  const p = (await r.json()) as PexelsPhoto;
  if (existing.has(p.url)) continue;
  // оригінали до 10к px: беремо 2560 по ширині, далі воркер сам зробить 1080/720 і превʼю
  const img = await fetch(`${p.src.original}?auto=compress&cs=tinysrgb&w=2560`, { headers: { "User-Agent": "Mozilla/5.0 deye-dashboard" } });
  if (!img.ok || !img.body) { console.log("download failed", ph.id, img.status); continue; }
  const srcRel = `src/pexels-photo-${p.id}.jpg`;
  await pipeline(Readable.fromWeb(img.body as never), createWriteStream(join(MEDIA_ROOT, srcRel)));
  await sql.begin(async (tx) => {
    const [bg] = await tx`insert into backgrounds (org_id, name, category, kind, license, source, attribution, status, source_file)
      values (null, ${ph.title}, ${PHOTO_CATEGORY}, 'image', 'Pexels License', ${p.url}, ${`${p.photographer} / Pexels`}, 'uploaded', ${srcRel}) returning id`;
    await tx`insert into transcode_jobs (background_id) values (${bg!.id})`;
  });
  existing.add(p.url); added++;
  console.log(`queued photo ${ph.title} (${p.width}x${p.height}, by ${p.photographer})`);
}
console.log(`done: ${added} backgrounds queued`);
await sql.end();
