/**
 * Черга AI-задач: той самий патерн, що transcode_jobs (FOR UPDATE SKIP LOCKED).
 * Без провайдера (немає XAI_API_KEY) задачі не беруться — лишаються queued до налаштування ключа.
 */
import { runMenuImport, type AiJobRow } from "./menu-import.ts";
import { runDishImage, runDishUpload } from "./dish-image.ts";
import type { AiProviders } from "./ai/types.ts";

type Sql = any;

export interface AiDeps { sql: Sql; providers: AiProviders; mediaRoot: string; log: (o: object) => void }

/** Бере одну задачу; повертає false, якщо черга порожня або нема чим її виконати. */
export async function runOneAiJob(deps: AiDeps): Promise<boolean> {
  const { sql, providers, mediaRoot, log } = deps;
  const kinds: string[] = ["dish_upload"];      // власне фото обробляється і без ключів AI
  if (providers.vision) kinds.push("menu_import");
  if (Object.keys(providers.images).length) kinds.push("dish_image");

  const job: AiJobRow | undefined = await sql.begin(async (tx: Sql) => {
    const [j] = await tx`
      update ai_jobs set status = 'running', started_at = now(), attempts = attempts + 1
      where id = (select id from ai_jobs where status = 'queued' and kind = any(${kinds}::ai_job_kind[])
                  order by created_at limit 1 for update skip locked)
      returning id, org_id, kind, ref_id, payload`;
    return j;
  });
  if (!job) return false;

  const t0 = Date.now();
  try {
    let result: object;
    if (job.kind === "menu_import") result = await runMenuImport(sql, job, providers.vision!, mediaRoot);
    else if (job.kind === "dish_image") result = await runDishImage(sql, job, providers.images, mediaRoot);
    else if (job.kind === "dish_upload") result = await runDishUpload(sql, job, mediaRoot);
    else throw new Error(`невідомий тип задачі ${job.kind}`);
    await sql`update ai_jobs set status = 'done', result = ${sql.json(result)}, finished_at = now() where id = ${job.id}`;
    log({ aiJob: job.id, kind: job.kind, ok: true, ms: Date.now() - t0, ...result });
  } catch (e) {
    const msg = String((e as Error).message ?? e).slice(0, 500);
    await sql.begin(async (tx: Sql) => {
      await tx`update ai_jobs set status = 'failed', error = ${msg}, finished_at = now() where id = ${job.id}`;
      // меню лишається користувачеві як чернетка: допише руками, ніж дивитись на «розпізнається»
      if (job.kind === "menu_import") await tx`update menus set status = 'draft', updated_at = now() where id = ${job.ref_id} and status = 'importing'`;
    });
    log({ aiJob: job.id, kind: job.kind, ok: false, ms: Date.now() - t0, error: msg });
  }
  return true;
}
