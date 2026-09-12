import Fastify from "fastify";
import { config } from "./config.ts";
import { db, sql } from "./db/client.ts";

const app = Fastify({ logger: { level: config.NODE_ENV === "production" ? "info" : "debug" } });

app.get("/api/health", async () => {
  const [row] = await sql`select now() as now, (select count(*)::int from inverter_models) as models`;
  return { ok: true, now: row?.now, models: row?.models };
});

app.addHook("onClose", async () => { await sql.end(); });
void db;

try {
  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
