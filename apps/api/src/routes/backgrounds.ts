import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/plugin.ts";
import * as bgs from "../backgrounds/service.ts";
import { badRequest } from "../lib/errors.ts";
import { member, orgIdParams, orgParams, type Deps } from "./common.ts";

/** Бібліотека фонів: стандартні + власні (відео/фото, транскодує worker). */
export async function backgroundRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  app.get("/api/orgs/:orgId/backgrounds", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    return bgs.listBackgrounds(db, orgId);
  });
  app.post("/api/orgs/:orgId/backgrounds", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const file = await req.file({ limits: { fileSize: bgs.MAX_UPLOAD_BYTES, files: 1 } });
    if (!file) throw badRequest("No file", "no_file");
    // фото менше за відео: обмеження вужче, ніж ліміт multipart
    const maxBytes = bgs.kindOf(file.mimetype) === "image" ? bgs.MAX_IMAGE_BYTES : bgs.MAX_UPLOAD_BYTES;
    const bg = await bgs.startUpload(db, orgId, u.id, file.mimetype, file.filename, file.file, deps.mediaRoot, maxBytes);
    if (file.file.truncated) { await bgs.deleteBackground(db, orgId, u.id, bg.id, deps.mediaRoot); throw badRequest(`File too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`, "too_large"); }
    return reply.code(201).send(bg);
  });
  app.patch("/api/orgs/:orgId/backgrounds/:id", async (req) => {
    const u = requireUser(req); const { orgId, id } = orgIdParams.parse(req.params);
    const { name } = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
    return bgs.renameBackground(db, orgId, u.id, id, name);
  });
  app.delete("/api/orgs/:orgId/backgrounds/:id", async (req, reply) => {
    const u = requireUser(req); const { orgId, id } = orgIdParams.parse(req.params);
    await bgs.deleteBackground(db, orgId, u.id, id, deps.mediaRoot);
    return reply.code(204).send();
  });
}
