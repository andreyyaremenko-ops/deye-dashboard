/**
 * Auth/ACL для mosquitto-go-auth (http backend, response_mode=status):
 * 2xx = дозволено, інше = ні. Пристрій: пише лише у свої devices/<id>/{telemetry,status,info},
 * читає лише devices/<id>/{cfg,cmd}. Внутрішній користувач API — superuser.
 */
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { devices } from "../db/schema.ts";
import { verifySecret } from "../lib/crypto.ts";

type Db = PgDatabase<any, any, any>;

export const ACC = { READ: 1, WRITE: 2, READWRITE: 3, SUBSCRIBE: 4 } as const;

const DEVICE_WRITE = new Set(["telemetry", "status", "info"]);
const DEVICE_READ = new Set(["cfg", "cmd"]);

export interface AclDeps { db: Db; internalUser: string; internalPass: string }

export async function mqttAuth(deps: AclDeps, username: string, password: string): Promise<boolean> {
  if (username === deps.internalUser) return !!deps.internalPass && password === deps.internalPass;
  const [d] = await deps.db.select({ secretHash: devices.secretHash }).from(devices).where(eq(devices.id, username));
  if (!d) return false;
  return verifySecret(password, d.secretHash);
}

export function mqttSuperuser(deps: AclDeps, username: string): boolean {
  return username === deps.internalUser;
}

/** Чиста функція: без БД, лише за іменем користувача і темою. */
export function mqttAclCheck(username: string, topic: string, acc: number): boolean {
  const m = /^devices\/([0-9a-f]{12})\/([a-z]+)$/.exec(topic);
  if (!m) return false;
  const [, id, leaf] = m;
  if (id !== username) return false;
  if (acc === ACC.WRITE) return DEVICE_WRITE.has(leaf!);
  if (acc === ACC.READ || acc === ACC.SUBSCRIBE) return DEVICE_READ.has(leaf!);
  return false; // READWRITE не даємо нікому з пристроїв
}
