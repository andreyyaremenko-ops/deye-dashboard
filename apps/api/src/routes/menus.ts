/**
 * Меню закладу: CRUD розділів і позицій, стиль фото, публікація.
 * Зміна опублікованого меню одразу летить на телевізори через наявний WS (notifyScreen).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { menuItemInputSchema, menuItemPatchSchema, menuSectionInputSchema } from "@deye/shared";
import { requireUser } from "../auth/plugin.ts";
import * as mn from "../menus/service.ts";
import { screensUsingMenu } from "../screens/service.ts";
import { member, orgParams, uuid, type Deps } from "./common.ts";

const menuParams = z.object({ orgId: uuid, menuId: uuid });
const sectionParams = menuParams.extend({ sectionId: uuid });
const itemParams = menuParams.extend({ itemId: uuid });

export async function menuRoutes(app: FastifyInstance, deps: Deps) {
  const { db, store } = deps;

  /** Телевізори, що показують це меню, отримують свіжий конфіг (ціни, наявність). */
  const notify = async (orgId: string, menuId: string) => {
    for (const id of await screensUsingMenu(db, orgId, menuId)) await store.notifyScreen(id);
  };

  app.get("/api/orgs/:orgId/menus", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    return mn.listMenus(db, orgId);
  });
  app.post("/api/orgs/:orgId/menus", async (req, reply) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    return reply.code(201).send(await mn.createMenu(db, orgId, u.id, name));
  });
  app.get("/api/orgs/:orgId/menus/:menuId", async (req) => {
    const { orgId, menuId } = await member(deps, req, menuParams, "staff");
    return mn.getMenu(db, orgId, menuId);
  });
  app.patch("/api/orgs/:orgId/menus/:menuId", async (req) => {
    const u = requireUser(req); const { orgId, menuId } = menuParams.parse(req.params);
    const patch = z.object({ name: z.string().trim().min(1).max(100).optional(), styleId: uuid.nullable().optional() }).parse(req.body);
    const m = await mn.updateMenu(db, orgId, u.id, menuId, patch);
    await notify(orgId, menuId);
    return m;
  });
  app.delete("/api/orgs/:orgId/menus/:menuId", async (req, reply) => {
    const u = requireUser(req); const { orgId, menuId } = menuParams.parse(req.params);
    await mn.deleteMenu(db, orgId, u.id, menuId);
    await notify(orgId, menuId);
    return reply.code(204).send();
  });
  app.post("/api/orgs/:orgId/menus/:menuId/publish", async (req) => {
    const u = requireUser(req); const { orgId, menuId } = menuParams.parse(req.params);
    const m = await mn.publishMenu(db, orgId, u.id, menuId);
    await notify(orgId, menuId);
    return m;
  });

  // --- розділи ---
  app.post("/api/orgs/:orgId/menus/:menuId/sections", async (req, reply) => {
    const u = requireUser(req); const { orgId, menuId } = menuParams.parse(req.params);
    const s = await mn.addSection(db, orgId, u.id, menuId, menuSectionInputSchema.parse(req.body));
    await notify(orgId, menuId);
    return reply.code(201).send(s);
  });
  app.patch("/api/orgs/:orgId/menus/:menuId/sections/:sectionId", async (req) => {
    const u = requireUser(req); const { orgId, menuId, sectionId } = sectionParams.parse(req.params);
    const s = await mn.updateSection(db, orgId, u.id, menuId, sectionId, menuSectionInputSchema.partial().parse(req.body));
    await notify(orgId, menuId);
    return s;
  });
  app.delete("/api/orgs/:orgId/menus/:menuId/sections/:sectionId", async (req, reply) => {
    const u = requireUser(req); const { orgId, menuId, sectionId } = sectionParams.parse(req.params);
    await mn.deleteSection(db, orgId, u.id, menuId, sectionId);
    await notify(orgId, menuId);
    return reply.code(204).send();
  });

  // --- позиції ---
  app.post("/api/orgs/:orgId/menus/:menuId/items", async (req, reply) => {
    const u = requireUser(req); const { orgId, menuId } = menuParams.parse(req.params);
    const i = await mn.addItem(db, orgId, u.id, menuId, menuItemInputSchema.parse(req.body));
    await notify(orgId, menuId);
    return reply.code(201).send(i);
  });
  app.patch("/api/orgs/:orgId/menus/:menuId/items/:itemId", async (req) => {
    const u = requireUser(req); const { orgId, menuId, itemId } = itemParams.parse(req.params);
    const i = await mn.updateItem(db, orgId, u.id, menuId, itemId, menuItemPatchSchema.parse(req.body));
    await notify(orgId, menuId);
    return i;
  });
  // наявність — доступна staff (офіціант), решта правок лише admin
  app.patch("/api/orgs/:orgId/menus/:menuId/items/:itemId/stock", async (req) => {
    const u = requireUser(req); const { orgId, menuId, itemId } = itemParams.parse(req.params);
    const { inStock } = z.object({ inStock: z.boolean() }).parse(req.body);
    const i = await mn.setStock(db, orgId, u.id, menuId, itemId, inStock);
    await notify(orgId, menuId);
    return i;
  });
  app.delete("/api/orgs/:orgId/menus/:menuId/items/:itemId", async (req, reply) => {
    const u = requireUser(req); const { orgId, menuId, itemId } = itemParams.parse(req.params);
    await mn.deleteItem(db, orgId, u.id, menuId, itemId);
    await notify(orgId, menuId);
    return reply.code(204).send();
  });

  // --- стиль фото закладу ---
  app.get("/api/orgs/:orgId/menu-style", async (req) => {
    const { orgId } = await member(deps, req, orgParams, "staff");
    return mn.getStyle(db, orgId);
  });
  app.put("/api/orgs/:orgId/menu-style", async (req) => {
    const u = requireUser(req); const { orgId } = orgParams.parse(req.params);
    const body = z.object({
      name: z.string().trim().min(1).max(60).optional(),
      prompt: z.string().trim().min(10).max(1000),
      bgMode: z.enum(["solid", "transparent"]).optional(),
      bgColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
    }).parse(req.body);
    return mn.saveStyle(db, orgId, u.id, body);
  });
}
