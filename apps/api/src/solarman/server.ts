/**
 * TCP-приймач для стіків (Server B). Кожен кадр -> logger_frames, відповідь-підтвердження.
 */
import net from "node:net";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { loggerFrames } from "../db/schema.ts";
import { buildResponse, CONTROL_NAMES, splitFrames } from "./v5.ts";

export interface LoggerServerDeps {
  db: PgDatabase<any, any, any>;
  log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
  onFrame?: (f: { serial: number; control: number; payload: Buffer; remoteIp: string }) => Promise<void> | void;
}

export function startLoggerServer(deps: LoggerServerDeps, port: number, host = "0.0.0.0") {
  const server = net.createServer((sock) => {
    const ip = sock.remoteAddress ?? "";
    let buf: Buffer = Buffer.alloc(0);
    let seq = 0;
    sock.setTimeout(10 * 60_000);
    deps.log.info({ ip }, "logger: connection");
    sock.on("data", async (chunk) => {
      deps.log.info({ ip, bytes: chunk.length, hex: chunk.subarray(0, 96).toString("hex") }, "logger: raw");
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest } = splitFrames(buf);
      buf = rest as Buffer;
      for (const f of frames) {
        deps.log.info({ ip, serial: f.serial, control: f.control.toString(16), name: CONTROL_NAMES[f.control] ?? "?", len: f.payload.length }, "logger: frame");
        try {
          await deps.db.insert(loggerFrames).values({ serial: f.serial, control: f.control, frame: f.raw, remoteIp: ip });
          await deps.onFrame?.({ serial: f.serial, control: f.control, payload: f.payload, remoteIp: ip });
        } catch (e) { deps.log.warn({ err: String(e) }, "logger: store failed"); }
        if (f.control >= 0x4000 && f.control < 0x5000) {
          seq = (seq + 1) & 0xff;
          sock.write(buildResponse(f, seq));
        }
      }
      if (buf.length > 4096) buf = Buffer.alloc(0) as Buffer; // сміття без 0xA5
    });
    sock.on("timeout", () => sock.destroy());
    sock.on("error", (e) => deps.log.warn({ ip, err: e.message }, "logger: socket error"));
    sock.on("close", () => deps.log.info({ ip }, "logger: closed"));
  });
  server.listen(port, host, () => deps.log.info({ port }, "logger server listening"));
  return server;
}
