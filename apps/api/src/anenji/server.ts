/**
 * TCP-приймач для WiFi-логерів Anenji/SRNE (порт 8899). Логер у режимі TCP-Client підключається,
 * ми опитуємо інвертор (AnenjiSession). Усе, що логер шле не у відповідь на наш запит, лягає
 * в logger_frames з control = 0x8899 — по цих байтах видно, якщо протокол виявиться іншим.
 */
import net from "node:net";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { loggerFrames } from "../db/schema.ts";
import type { IngestDeps } from "../mqtt/ingest.ts";
import { AnenjiLink } from "./link.ts";
import { AnenjiSession, type SessionInfo } from "./session.ts";

/** Позначка в logger_frames: кадр прийшов з порту Anenji, а не від Solarman-стіка. */
export const ANENJI_CONTROL = 0x8899;
/** Скільки сторонніх кадрів писати в БД на одне зʼєднання: балакучий логер не має залити таблицю. */
const JUNK_LIMIT = 20;
const IDLE_MS = 10 * 60_000;
/** Порт відкритий у світ, тому межі: стільки зʼєднань усього і стільки з однієї адреси. */
const MAX_CONNECTIONS = 32;
const MAX_PER_IP = 4;

export interface AnenjiServerDeps {
  db: PgDatabase<any, any, any>;
  ingest: IngestDeps;
  log: IngestDeps["log"];
  intervalMs?: number;
  gapMs?: number;
  probeMs?: number;
}

export function startAnenjiServer(deps: AnenjiServerDeps, port: number, host = "0.0.0.0") {
  const sessions = new Set<AnenjiSession>();
  const server = net.createServer((sock) => {
    const ip = sock.remoteAddress ?? "";
    const fromIp = [...sessions].filter((s) => s.ip === ip).length;
    if (sessions.size >= MAX_CONNECTIONS || fromIp >= MAX_PER_IP) {
      deps.log.warn({ ip, total: sessions.size, fromIp }, "anenji: зайве зʼєднання відкинуто");
      sock.destroy();
      return;
    }
    sock.setTimeout(IDLE_MS);
    sock.setNoDelay(true);
    deps.log.info({ ip, port }, "anenji: підключення");
    let junk = 0;
    const link = new AnenjiLink(sock, deps.log, (buf, kind, control) => {
      if (junk++ >= JUNK_LIMIT) return;
      deps.log.info({ ip, kind, len: buf.length, head: buf.subarray(0, 16).toString("hex") }, "anenji: сторонні байти");
      void deps.db.insert(loggerFrames).values({
        serial: link.loggerSerial, control: control ?? ANENJI_CONTROL, frame: buf, remoteIp: ip,
      }).catch(() => {});
    });
    const session = new AnenjiSession(sock, deps, link);
    sessions.add(session);
    void session.start().then((ok) => {
      if (!ok) return;
      // те саме залізо перепідключилось — старий цикл більше не потрібен
      for (const prev of sessions) if (prev !== session && prev.sn && prev.sn === session.sn) prev.stop("замінено новим зʼєднанням");
    });
    sock.on("timeout", () => sock.destroy());
    sock.on("close", () => sessions.delete(session));
    sock.on("error", () => {});
  });
  server.listen(port, host, () => deps.log.info({ port }, "anenji server listening"));
  return { server, sessions, list: (): SessionInfo[] => [...sessions].map((s) => s.info()) };
}
