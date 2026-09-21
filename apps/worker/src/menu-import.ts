/**
 * Задача menu_import: фото паперового меню -> розділи й позиції чернетки.
 * Невдача теж лишає користувачеві чернетку (порожню) — він допише меню руками.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { VISION_SYSTEM, VISION_USER, parseVisionMenu } from "@deye/shared/menu-ai";
import type { AiUsage, VisionProvider } from "./ai/types.ts";

export interface AiJobRow {
  id: string;
  org_id: string;
  kind: "menu_import" | "dish_image";
  ref_id: string;
  payload: Record<string, unknown>;
}

type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]>;
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
};

const mimeOf = (file: string) => (file.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");

/** Пише рядок обліку вартості: він же база для місячних лімітів тарифу. */
export async function logUsage(sql: Sql, orgId: string, jobId: string | null, kind: string, u: AiUsage) {
  await sql`insert into ai_usage (org_id, job_id, kind, provider, model, tokens_in, tokens_out, images, cost_micros)
    values (${orgId}, ${jobId}, ${kind}, ${u.provider}, ${u.model}, ${u.tokensIn}, ${u.tokensOut}, ${u.images}, ${u.costMicros})`;
}

export async function runMenuImport(sql: Sql, job: AiJobRow, vision: VisionProvider, mediaRoot: string) {
  const files = (job.payload.files as string[] | undefined) ?? [];
  if (!files.length) throw new Error("menu_import без файлів");
  const images = await Promise.all(files.map(async (f) => ({ data: await readFile(join(mediaRoot, f)), mime: mimeOf(f) })));

  const { raw, usage } = await vision.readMenu(images, { system: VISION_SYSTEM, user: VISION_USER });
  const sections = parseVisionMenu(raw);            // кидає, якщо модель відповіла не тим
  let items = 0;

  await sql.begin(async (tx) => {
    const [top] = await tx`select coalesce(max(sort), -1) + 1 as next from menu_sections where menu_id = ${job.ref_id}`;
    let sort = Number(top?.next ?? 0);
    for (const s of sections) {
      const [sec] = await tx`insert into menu_sections (menu_id, name, sort) values (${job.ref_id}, ${s.name}, ${sort++}) returning id`;
      let isort = 0;
      for (const i of s.items) {
        await tx`insert into menu_items (menu_id, section_id, name, description, price, volume, sort, confidence)
          values (${job.ref_id}, ${sec!.id}, ${i.name}, ${i.description}, ${i.price}, ${i.volume}, ${isort++}, ${i.confidence})`;
        items++;
      }
    }
    await tx`update menus set status = 'draft', updated_at = now() where id = ${job.ref_id}`;
    await logUsage(tx, job.org_id, job.id, "menu_import", usage);
  });

  return { sections: sections.length, items, costMicros: usage.costMicros, model: usage.model };
}
