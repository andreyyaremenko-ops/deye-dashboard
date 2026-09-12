import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { createAuth } from "../src/auth/create-auth.ts";
import { schema, user } from "../src/db/schema.ts";
import { seed } from "../src/db/seed.ts";
import { MemoryStateStore } from "../src/state/store.ts";
import type { Mail } from "../src/mail/index.ts";

export const INTERNAL = { user: "api", pass: "internal-test-pass" };

export async function makeTestApp() {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  const dir = join(import.meta.dirname, "../drizzle");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql") && !f.includes("timescale")).sort()) {
    for (const stmt of readFileSync(join(dir, file), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  await seed(db);
  const mails: Mail[] = [];
  const auth = createAuth(db, async (m) => { mails.push(m); });
  const store = new MemoryStateStore();
  const app = await buildApp({
    db, auth, store, publicUrl: "http://localhost:5173",
    mqttInternalUser: INTERNAL.user, mqttInternalPass: INTERNAL.pass,
    mediaRoot: mkdtempSync(join(tmpdir(), "deye-media-")),
  });
  await app.ready();
  return { app, db, store, mails, pg, close: async () => { await app.close(); await pg.close(); } };
}

export type TestApp = Awaited<ReturnType<typeof makeTestApp>>;

/** Реєстрація через реальний endpoint Better Auth; повертає cookie для наступних запитів. */
export async function signUp(app: FastifyInstance, email: string, name = email.split("@")[0]!) {
  const res = await app.inject({
    method: "POST", url: "/api/auth/sign-up/email",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    payload: { email, password: "correct horse battery staple", name },
  });
  if (res.statusCode !== 200) throw new Error(`sign-up failed ${res.statusCode}: ${res.body}`);
  const setCookie = res.headers["set-cookie"];
  const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie!]).map((c) => c.split(";")[0]).join("; ");
  const body = res.json() as { user: { id: string } };
  return { cookie: cookies, userId: body.user.id };
}

export async function makeSuperadmin(t: TestApp, userId: string) {
  await t.db.update(user).set({ is_superadmin: true }).where(eq(user.id, userId));
}

export function api(app: FastifyInstance, cookie: string) {
  return {
    get: (url: string) => app.inject({ method: "GET", url, headers: { cookie } }),
    post: (url: string, payload?: unknown) => app.inject({ method: "POST", url, headers: { cookie, "content-type": "application/json" }, payload: payload as never }),
    patch: (url: string, payload?: unknown) => app.inject({ method: "PATCH", url, headers: { cookie, "content-type": "application/json" }, payload: payload as never }),
    del: (url: string) => app.inject({ method: "DELETE", url, headers: { cookie } }),
  };
}
