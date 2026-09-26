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
  for (const view of ROLLUP_VIEWS) {
    const [cagg] = await sql<{ mat: string }[]>`
      select format('%I.%I', materialization_hypertable_schema, materialization_hypertable_name) as mat
      from timescaledb_information.continuous_aggregates where view_name = ${view}`;
    if (!cagg) continue;
    // саме матеріалізована таблиця, а не view: через materialized_only = false view віддала б і сирий хвіст
    const [filled] = await sql.unsafe<{ x: number }[]>(`select 1 as x from ${cagg.mat} limit 1`);
    if (filled) continue;
    const t0 = Date.now();
    await sql.unsafe(`call refresh_continuous_aggregate('${view}', null, null)`);
    console.log(`rollups: ${view} наповнено за ${Math.round((Date.now() - t0) / 1000)} с`);
  }
}

await sql.end();
