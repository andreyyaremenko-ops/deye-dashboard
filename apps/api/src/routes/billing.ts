import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/plugin.ts";
import * as bill from "../billing/service.ts";
import { verifyMonoSignature } from "../billing/mono.ts";
import { member, orgParams, uuid, type Deps } from "./common.ts";

/** Оплата тарифу через monobank acquiring. */
export async function billingRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const billingDeps = { db, mono: deps.mono ?? null, publicUrl: deps.publicUrl, log: app.log };

  app.get("/api/orgs/:orgId/billing", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    return { ...(await bill.billingInfo(db, orgId)), enabled: !!deps.mono };
  });
  app.post("/api/orgs/:orgId/billing/checkout", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { planId, months } = z.object({ planId: z.string().default("pro"), months: z.number().int() }).parse(req.body);
    return bill.checkout(billingDeps, orgId, u.id, planId, months);
  });
  app.get("/api/orgs/:orgId/billing/payments/:paymentId", async (req) => {
    const u = requireUser(req); const { orgId, paymentId } = z.object({ orgId: uuid, paymentId: uuid }).parse(req.params);
    return bill.refreshPayment(billingDeps, orgId, u.id, paymentId);
  });
  // вебхук monobank: сире тіло + X-Sign
  app.post("/api/billing/mono/webhook", { config: { rawBody: true } }, async (req, reply) => {
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body);
    const sign = req.headers["x-sign"];
    if (!deps.mono || typeof sign !== "string") return reply.code(400).send({ error: "no_sign" });
    const pem = await deps.mono.getPubKey();
    if (!verifyMonoSignature(raw, sign, pem)) { app.log.warn({ ip: req.ip }, "billing: bad webhook signature"); return reply.code(400).send({ error: "bad_sign" }); }
    await bill.applyStatus(billingDeps, req.body as never);
    return { ok: true };
  });
}
