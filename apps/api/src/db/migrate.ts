import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.ts";
import { ROLLUP_VIEWS } from "../history/service.ts";

await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
console.log("migrations applied");

/**
 * Перше наповнення ролапів. refresh_continuous_aggregate не можна викликати всередині транзакції,
 * тому це тут, а не в міграції. Без нього стара історія зникла б із графіків: real-time aggregation
 * добирає з сирої таблиці лише хвіст після останнього матеріалізованого бакета, а не все до нього.
 * Повторний повний refresh не робимо: він перерахував би й старі бакети, а після ретенції сирих
 * рядків це стерло б довгу історію з ролапів.
 */
await backfillRollups();

async function backfillRollups() {
  const [ts] = await sql<{ ok: boolean }[]>`select to_regclass('timescaledb_information.continuous_aggregates') is not null as ok`;
  if (!ts?.ok) { console.log("rollups: Timescale не знайдено, пропускаю"); return; }
  const [raw] = await sql<{ from: Date | null }[]>`
    select min(range_start) as from from timescaledb_information.chunks where hypertable_name = 'telemetry'`;
  if (!raw?.from) return;                                    // порожня база — наповнювати нічого
  for (const view of ROLLUP_VIEWS) {
    // Порівнюємо покриття, а не «чи є рядки»: політика оновлення могла вже запуститись і залити
    // тільки своє вікно (start_offset), і тоді старіша історія лишилась би поза ролапом назавжди.
    // Після ретенції сирих рядків min(range_start) сирої таблиці зсувається вперед, тож зайвого
    // повного refresh (який стер би довгу історію з ролапу) не станеться.
    const [cov] = await sql<{ from: Date | null }[]>`
      select (select min(range_start) from timescaledb_information.chunks ch
               where ch.hypertable_name = ca.materialization_hypertable_name) as from
      from timescaledb_information.continuous_aggregates ca where ca.view_name = ${view}`;
    if (!cov) continue;
    if (cov.from && cov.from <= raw.from) continue;
    const t0 = Date.now();
    await sql.unsafe(`call refresh_continuous_aggregate('${view}', null, null)`);
    console.log(`rollups: ${view} наповнено за ${Math.round((Date.now() - t0) / 1000)} с`);
  }
}

await sql.end();
