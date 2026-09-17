import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { mqttAclCheck, mqttAuth, mqttSuperuser } from "../mqtt/acl.ts";
import { forbidden } from "../lib/errors.ts";
import type { Deps } from "./common.ts";

const isPrivate = (ip: string) => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:(127\.|10\.|192\.168\.|172\.))/.test(ip);

/** mosquitto-go-auth: auth/superuser/acl брокера. Лише з docker-мережі. */
export async function internalRoutes(app: FastifyInstance, deps: Deps) {
  const mqttDeps = { db: deps.db, internalUser: deps.mqttInternalUser, internalPass: deps.mqttInternalPass };
  app.addHook("onRequest", async (req) => { if (!isPrivate(req.ip)) throw forbidden(); });

  app.post("/internal/mqtt/auth", async (req, reply) => {
    const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body);
    return reply.code((await mqttAuth(mqttDeps, username, password)) ? 200 : 401).send();
  });
  app.post("/internal/mqtt/superuser", async (req, reply) => {
    const { username } = z.object({ username: z.string() }).parse(req.body);
    return reply.code(mqttSuperuser(mqttDeps, username) ? 200 : 403).send();
  });
  app.post("/internal/mqtt/acl", async (req, reply) => {
    const { username, topic, acc } = z.object({ username: z.string(), topic: z.string(), acc: z.coerce.number() }).parse(req.body);
    if (mqttSuperuser(mqttDeps, username)) return reply.code(200).send();
    return reply.code(mqttAclCheck(username, topic, acc) ? 200 : 403).send();
  });
}
