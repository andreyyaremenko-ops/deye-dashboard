/**
 * Задачі фото страв:
 *   dish_image  — згенерувати N варіантів у стилі закладу (провайдер зображень);
 *   dish_upload — обробити власне фото власника (без AI).
 * Обидві зводять картинку до квадрата 1:1 і кладуть у /media/dish, який роздає Caddy.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_MENU_STYLE, dishPrompt } from "@deye/shared/menu-ai";
import { dishPhoto } from "./transcode.ts";
import { logUsage, type AiJobRow } from "./menu-import.ts";
import type { AiOutputImage, AiProviders, ImageProviderId } from "./ai/types.ts";

type Sql = any;

/** Скільки варіантів пропонуємо на страву, якщо задача не каже іншого. */
export const DEFAULT_VARIANTS = 3;
const MAX_VARIANTS = 4;

interface ItemRow {
  id: string; name: string; description: string | null; menu_id: string; org_id: string;
  prompt: string | null; bg_mode: string | null; bg_color: string | null;
}

/** Позиція + стиль її меню (стиль меню, інакше стиль закладу за замовчуванням). */
async function itemWithStyle(sql: Sql, itemId: string): Promise<ItemRow | undefined> {
  const [row] = await sql`
    select i.id, i.name, i.description, i.menu_id, m.org_id,
           coalesce(ms.prompt, def.prompt) as prompt,
           coalesce(ms.bg_mode, def.bg_mode) as bg_mode,
           coalesce(ms.bg_color, def.bg_color) as bg_color
    from menu_items i
    join menus m on m.id = i.menu_id
    left join menu_styles ms on ms.id = m.style_id
    left join menu_styles def on def.org_id = m.org_id and def.is_default
    where i.id = ${itemId}`;
  return row;
}

/** Зберігає один файл у /media/dish як квадрат 1:1 і додає рядок dish_images. */
async function storeVariant(sql: Sql, opts: {
  orgId: string; itemId: string; mediaRoot: string; bytes: Buffer; mime: string;
  isAi: boolean; prompt: string | null; provider: string | null; model: string | null; alpha?: boolean;
}) {
  const id = randomUUID();
  const tmp = join(opts.mediaRoot, "dish", `${id}.src`);
  await mkdir(join(opts.mediaRoot, "dish"), { recursive: true });
  await writeFile(tmp, opts.bytes);
  try {
    const out = await dishPhoto(tmp, join(opts.mediaRoot, "dish", id), opts.mediaRoot, { alpha: opts.alpha });
    const [row] = await sql`
      insert into dish_images (id, org_id, item_id, status, file, thumb, width, height, bytes, is_ai, provider, model, prompt)
      values (${id}, ${opts.orgId}, ${opts.itemId}, 'ready', ${out.file}, ${out.thumb}, ${out.width}, ${out.height}, ${out.bytes},
              ${opts.isAi}, ${opts.provider}, ${opts.model}, ${opts.prompt})
      returning id`;
    return row!.id as string;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export async function runDishImage(sql: Sql, job: AiJobRow, providers: AiProviders["images"], mediaRoot: string) {
  const item = await itemWithStyle(sql, job.ref_id);
  if (!item) throw new Error("позицію меню видалено");
  const n = Math.min(MAX_VARIANTS, Math.max(1, Number(job.payload.n ?? DEFAULT_VARIANTS)));
  // провайдер і модель зафіксовані в задачі при постановці; старі задачі без них — Grok за замовчуванням
  const providerId = String(job.payload.provider ?? "xai") as ImageProviderId;
  const image = providers[providerId];
  if (!image) throw new Error(`Провайдер ${providerId} не налаштований (немає ключа на сервері)`);
  const model = typeof job.payload.model === "string" ? job.payload.model : undefined;
  const quality = (job.payload.quality ?? "medium") as "low" | "medium" | "high";
  const alpha = job.payload.alpha === true;
  const style = { prompt: item.prompt ?? DEFAULT_MENU_STYLE.prompt, bgMode: item.bg_mode, bgColor: item.bg_color };
  const prompt = dishPrompt(style, { name: item.name, description: item.description }, { alpha });

  const { images, usage } = await image.generate(prompt, n, { model, quality, alpha });
  const ids: string[] = [];
  for (const img of images as AiOutputImage[]) {
    ids.push(await storeVariant(sql, {
      orgId: item.org_id, itemId: item.id, mediaRoot, bytes: img.data, mime: img.mime,
      isAi: true, prompt, provider: usage.provider, model: usage.model, alpha,
    }));
  }
  await logUsage(sql, item.org_id, job.id, "dish_image", usage);
  // перше фото стає обраним, якщо в страви ще немає жодного
  await sql`update menu_items set image_id = ${ids[0]!}, image_is_ai = true, updated_at = now()
            where id = ${item.id} and image_id is null`;
  return { variants: ids.length, costMicros: usage.costMicros, model: usage.model };
}

/** Власне фото власника: той самий квадрат, але is_ai = false і одразу обране. */
export async function runDishUpload(sql: Sql, job: AiJobRow, mediaRoot: string) {
  const item = await itemWithStyle(sql, job.ref_id);
  if (!item) throw new Error("позицію меню видалено");
  const src = String(job.payload.file ?? "");
  if (!src) throw new Error("dish_upload без файлу");
  const bytes = await readFile(join(mediaRoot, src));
  const id = await storeVariant(sql, {
    orgId: item.org_id, itemId: item.id, mediaRoot, bytes, mime: "image/jpeg",
    isAi: false, prompt: null, provider: null, model: null,
  });
  await sql`update menu_items set image_id = ${id}, image_is_ai = false, updated_at = now() where id = ${item.id}`;
  await unlink(join(mediaRoot, src)).catch(() => {});
  return { variants: 1, imageId: id };
}
