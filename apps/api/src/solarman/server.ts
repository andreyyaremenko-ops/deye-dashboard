/**
 * TCP-приймач для стіків (порт 10000). Стік у режимі TCP-Client підключається, ми опитуємо
 * (StickSession). Кадри, що стік шле сам (hello/heartbeat/data push), лягають у logger_frames.
 */
import net from "node:net";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { loggerFrames } from "../db/schema.ts";
import type { IngestDeps } from "../mqtt/ingest.ts";
import { StickSession } from "./session.ts";
import { buildResponse, CONTROL_NAMES, type V5Frame } from "./v5.ts";

export interface LoggerServerDeps {
  db: PgDatabase<any, any, any>;
  ingest: IngestDeps;
  log: IngestDeps["log"];
  intervalMs?: number;
}

export function startLoggerServer(deps: LoggerServerDeps, port: number, host = "0.0.0.0") {
  const sessions = new Map<number, StickSession>();
  const server = net.createServer((sock) => {
    const ip = sock.remoteAddress ?? "";
    sock.setTimeout(10 * 60_000);
    sock.setNoDelay(true);
    deps.log.info({ ip }, "stick: connection");
    let ackSeq = 0;
    const onFrame = (f: V5Frame) => {
      deps.log.info({ ip, serial: f.serial, control: f.control.toString(16), name: CONTROL_NAMES[f.control] ?? "?", len: f.payload.length }, "stick: unsolicited frame");
      void deps.db.insert(loggerFrames).values({ serial: f.serial, control: f.control, frame: f.raw, remoteIp: ip }).catch(() => {});
      if (f.control >= 0x4000 && f.control < 0x5000) { ackSeq = (ackSeq + 1) & 0xff; sock.write(buildResponse(f, ackSeq)); }
    };
    const session = new StickSession(sock, { db: deps.db, ingest: deps.ingest, log: deps.log, intervalMs: deps.intervalMs }, onFrame);
    void session.start().then((ok) => {
      if (!ok) return;
      const prev = sessions.get(session.serial);
      if (prev && prev !== session) prev.stop("replaced by new connection");
      sessions.set(session.serial, session);
    });
    sock.on("timeout", () => sock.destroy());
    sock.on("close", () => { if (sessions.get(session.serial) === session) sessions.delete(session.serial); });
    sock.on("error", () => {});
  });
  server.listen(port, host, () => deps.log.info({ port }, "stick server listening"));
  return { server, sessions };
}
