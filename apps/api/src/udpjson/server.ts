/**
 * Приймач готових метрик по UDP (порт 8899/udp): ESP32 біля інвертора Anenji шле JSON.
 *
 * UDP нікого не питає і нічим не підтверджується, тому тут усе, що можна зробити без
 * зміни прошивки: пакет не більше кіловайта, суворий розбір, обмеження частоти на пристрій
 * і привʼязка до адреси — перший пакет закріплює IP за пристроєм, і чужа адреса далі не
 * приймається, доки пристрій не замовкне на 10 хвилин (домашній IP може змінитись).
 * Повноцінний захист — це токен у пакеті, його можна додати, коли буде зміна прошивки.
 */
import dgram from "node:dgram";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { devices } from "../db/schema.ts";
import { sha256 } from "../lib/crypto.ts";
import { handleMetrics, type IngestDeps } from "../mqtt/ingest.ts";
import { toMetrics, udpClaimCode, udpDeviceId, udpPayloadSchema } from "./payload.ts";

const MAX_PACKET = 1024;
/** Стільки пристроїв тримаємо в памʼяті; більше — явно не наш трафік. */
const MAX_TRACKED = 200;
/** Після такої тиші пристрій може прийти з іншої адреси (змінився домашній IP). */
const REPIN_AFTER_MS = 10 * 60_000;

export interface UdpJsonDeps {
  db: PgDatabase<any, any, any>;
  ingest: IngestDeps;
  log: IngestDeps["log"];
}

export interface UdpSenderInfo {
  deviceId: string; name: string; ip: string; packets: number; rejected: number;
  lastAt: string; lastError: string | null;
}

interface Tracked {
  deviceId: string; name: string; ip: string; packets: number; rejected: number;
  lastAt: number; lastError: string | null;
}

export function startUdpJsonServer(deps: UdpJsonDeps, port: number, host = "0.0.0.0") {
  const seen = new Map<string, Tracked>();
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });

  sock.on("message", (buf, from) => { void onMessage(buf, from.address); });
  sock.on("error", (e) => deps.log.warn({ err: e.message }, "udp json: помилка сокета"));
  sock.bind(port, host, () => deps.log.info({ port: sock.address().port }, "udp json server listening"));

  async function onMessage(buf: Buffer, ip: string) {
    if (buf.length > MAX_PACKET) return;
    let parsed;
    try { parsed = udpPayloadSchema.safeParse(JSON.parse(buf.toString("utf8"))); }
    catch { return; }                                  // не JSON — тиша, порт відкритий у світ
    if (!parsed.success) {
      deps.log.warn({ ip, issues: parsed.error.issues.slice(0, 2) }, "udp json: пакет не за схемою");
      return;
    }
    const p = parsed.data;
    const deviceId = udpDeviceId(p.device);
    const now = Date.now();
    let t = seen.get(deviceId);
    if (!t) {
      if (seen.size >= MAX_TRACKED) return;
      t = { deviceId, name: p.device, ip, packets: 0, rejected: 0, lastAt: 0, lastError: null };
      seen.set(deviceId, t);
      deps.log.info({ ip, deviceId, name: p.device, claimCode: udpClaimCode(deviceId) }, "udp json: новий пристрій");
    }
    // привʼязка до адреси: чужий IP не може підсунути метрики за живий пристрій
    if (t.ip !== ip) {
      if (now - t.lastAt < REPIN_AFTER_MS) {
        t.rejected++; t.lastError = `чужа адреса ${ip}`;
        deps.log.warn({ deviceId, pinned: t.ip, from: ip }, "udp json: пакет з чужої адреси відкинуто");
        return;
      }
      deps.log.info({ deviceId, was: t.ip, now: ip }, "udp json: пристрій змінив адресу");
      t.ip = ip;
    }
    t.name = p.device;
    try {
      await ensureDevice(deviceId, p.device);
      const r = await handleMetrics(deps.ingest, deviceId, toMetrics(p));
      if (r.ok) { t.packets++; t.lastAt = now; t.lastError = null; }
      else if (r.reason !== "rate_limited") t.lastError = r.reason;
    } catch (e) {
      t.lastError = String(e);
      deps.log.warn({ deviceId, err: String(e) }, "udp json: збій інжесту");
    }
  }

  async function ensureDevice(deviceId: string, name: string) {
    const [d] = await deps.db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId));
    if (d) return;
    await deps.db.insert(devices).values({
      id: deviceId, hw: "esp32-udp", fw: "json",
      secretHash: "none", claimCodeHash: sha256(udpClaimCode(deviceId)),
      name: `Інвертор ${name}`.slice(0, 100),
    }).onConflictDoNothing();
    deps.log.info({ deviceId, claimCode: udpClaimCode(deviceId) }, "udp json: пристрій зареєстровано");
  }

  return {
    sock,
    close: () => new Promise<void>((r) => sock.close(() => r())),
    list: (): UdpSenderInfo[] => [...seen.values()].map((t) => ({
      deviceId: t.deviceId, name: t.name, ip: t.ip, packets: t.packets, rejected: t.rejected,
      lastAt: t.lastAt ? new Date(t.lastAt).toISOString() : "", lastError: t.lastError,
    })),
  };
}
