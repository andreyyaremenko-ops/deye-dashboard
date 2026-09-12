/**
 * Черга транскодування: бере transcode_jobs (queued) по одному, FOR UPDATE SKIP LOCKED,
 * транскодує backgrounds.source_file -> files/preview, ставить status ready|failed.
 */
import postgres from "postgres";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { transcode } from "./transcode.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://deye:deye@localhost:5432/deye";
const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/media";
const POLL_MS = Number(process.env.POLL_MS ?? 5000);
const KEEP_SOURCE = process.env.KEEP_SOURCE === "1";

const sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
const log = (o: object) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...o }));

export async function runOne(): Promise<boolean> {
  const job = await sql.begin(async (tx) => {
    const [j] = await tx`
      update transcode_jobs set status = 'running'
      where id = (select id from transcode_jobs where status = 'queued' order by created_at limit 1 for update skip locked)
      returning id, background_id`;
    return j as { id: string; background_id: string } | undefined;
  });
  if (!job) return false;
  const [bg] = await sql`select id, source_file from backgrounds where id = ${job.background_id}`;
  const t0 = Date.now();
  try {
    if (!bg?.source_file) throw new Error("background has no source_file");
    const input = join(MEDIA_ROOT, bg.source_file as string);
    const res = await transcode(input, join(MEDIA_ROOT, "bg", bg.id as string), MEDIA_ROOT);
    await sql.begin(async (tx) => {
      await tx`update backgrounds set status = 'ready', files = ${tx.json(res.files)}, preview = ${res.preview}, duration_s = ${Math.round(res.info.duration)} where id = ${bg.id}`;
      await tx`update transcode_jobs set status = 'done', finished_at = now() where id = ${job.id}`;
    });
    if (!KEEP_SOURCE) await unlink(input).catch(() => {});
    log({ job: job.id, background: bg.id, ok: true, ms: Date.now() - t0, bytes: res.bytes, src: `${res.info.width}x${res.info.height}@${res.info.fps.toFixed(0)} ${res.info.duration.toFixed(1)}s` });
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 500);
    await sql.begin(async (tx) => {
      await tx`update backgrounds set status = 'failed' where id = ${job.background_id}`;
      await tx`update transcode_jobs set status = 'failed', error = ${msg}, finished_at = now() where id = ${job.id}`;
    });
    log({ job: job.id, ok: false, error: msg });
  }
  return true;
}

if (process.argv[1]?.endsWith("worker.ts")) {
  log({ msg: "worker started", media: MEDIA_ROOT });
  // зависла джоба після рестарту -> назад у чергу
  await sql`update transcode_jobs set status = 'queued' where status = 'running'`;
  for (;;) {
    let did = false;
    try { did = await runOne(); } catch (e) { log({ error: String(e) }); }
    if (!did) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
