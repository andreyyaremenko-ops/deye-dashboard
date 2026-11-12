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
const UDP_HW = "esp32-udp";
/** fw пристрою, який хоч раз прийшов із токеном: відтоді без токена за нього не приймаємо. */
const TOKEN_FW = "json+token";
/** Стільки пристроїв без токена тримаємо в памʼяті; більше — явно не наш трафік. */
const MAX_TRACKED = 200;
/** Стеля для пристроїв партнерів із токеном: тисячі станцій — нормальний масштаб. */
const MAX_TRUSTED = 10_000;
/** Хто мовчить довше, забувається, коли місце скінчилось. */
const FORGET_AFTER_MS = 60 * 60_000;
/** Після такої тиші пристрій може прийти з іншої адреси (змінився домашній IP). */
const REPIN_AFTER_MS = 10 * 60_000;

export interface UdpJsonDeps {
  db: PgDatabase<any, any, any>;
  ingest: IngestDeps;
  log: IngestDeps["log"];
  /** sha256(токен) -> імʼя партнера (parseUdpTokens) */
  tokens?: Map<string, string>;
}

export interface UdpSenderInfo {
  deviceId: string; name: string; ip: string; via: string | null; packets: number; rejected: number;
  lastAt: string; lastError: string | null;
}

interface Tracked {
  deviceId: string; name: string; ip: string; via: string | null; packets: number; rejected: number;
  lastAt: number; lastError: string | null;
}

/**
 * UDPJSON_TOKENS = "solar=abc…,other=def…" -> sha256(токен) -> імʼя. Ключ — хеш, щоб пошук
 * у мапі не підказував токен таймінгами; токени коротші за 16 символів ігноруються.
 */
export function parseUdpTokens(spec: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of spec.split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim(), token = part.slice(i + 1).trim();
    if (name && token.length >= 16) m.set(sha256(token), name);
  }
  return m;
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
    // хибний токен — не «пакет без токена», а чужий: такий не приймаємо зовсім
    const via = p.token === undefined ? null : deps.tokens?.get(sha256(p.token)) ?? null;
    if (p.token !== undefined && !via) {
      deps.log.warn({ ip, device: p.device }, "udp json: невідомий токен, пакет відкинуто");
      return;
    }
    const deviceId = udpDeviceId(p.device);
    const now = Date.now();
    let t = seen.get(deviceId);
    if (!t) {
      if (!hasRoom(!!via, now)) return;
      t = { deviceId, name: p.device, ip, via, packets: 0, rejected: 0, lastAt: 0, lastError: null };
      seen.set(deviceId, t);
      deps.log.info({ ip, deviceId, name: p.device, via, claimCode: udpClaimCode(p.device) }, "udp json: новий пристрій");
    }
    if (via) {
      // партнер із токеном може змінити IP (домашнє підключення) — станції не мають зникати з екранів
      t.via = via; t.ip = ip;
    } else if (t.ip !== ip) {
      // привʼязка до адреси: чужий IP не може підсунути метрики за живий пристрій
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
      const st = await ensureDevice(deviceId, p.device, via);
      if (st !== "ok") {
        t.rejected++; t.lastError = st === "foreign" ? "id зайнятий пристроєм іншого типу" : "пристрій партнера, потрібен токен";
        return;
      }
      const r = await handleMetrics(deps.ingest, deviceId, toMetrics(p));
      if (r.ok) { t.packets++; t.lastAt = now; t.lastError = null; }
      else if (r.reason !== "rate_limited") t.lastError = r.reason;
    } catch (e) {
      t.lastError = String(e);
      deps.log.warn({ deviceId, err: String(e) }, "udp json: збій інжесту");
    }
  }

  /** Місце для нового пристрою: окремі стелі з токеном і без; бракує — забуваємо тих, хто давно мовчить. */
  function hasRoom(trusted: boolean, now: number): boolean {
    const used = () => { let n = 0; for (const x of seen.values()) if (!!x.via === trusted) n++; return n; };
    const cap = trusted ? MAX_TRUSTED : MAX_TRACKED;
    if (used() < cap) return true;
    for (const [id, x] of seen) if (now - x.lastAt > FORGET_AFTER_MS) seen.delete(id);
    return used() < cap;
  }

  /**
   * foreign — id уже належить стіку чи платі (той самий серійник Deye): UDP туди не пишемо,
   * інакше будь-хто, хто знає серійник, підсовував би метрики в чужий привʼязаний інвертор.
   * needs_token — пристрій партнера (хоч раз приходив із токеном), а пакет без токена.
   */
  async function ensureDevice(deviceId: string, name: string, via: string | null): Promise<"ok" | "foreign" | "needs_token"> {
    const [d] = await deps.db.select({ hw: devices.hw, fw: devices.fw }).from(devices).where(eq(devices.id, deviceId));
    if (d) {
      if (d.hw !== UDP_HW) {
        deps.log.warn({ deviceId, hw: d.hw }, "udp json: id належить пристрою іншого типу, пакет відкинуто");
        return "foreign";
      }
      if (d.fw === TOKEN_FW && !via) return "needs_token";
      if (d.fw !== TOKEN_FW && via) await deps.db.update(devices).set({ fw: TOKEN_FW }).where(eq(devices.id, deviceId));
      return "ok";
    }
    await deps.db.insert(devices).values({
      id: deviceId, hw: UDP_HW, fw: via ? TOKEN_FW : "json",
      secretHash: "none", claimCodeHash: sha256(udpClaimCode(name)),
      name: `Інвертор ${name}`.slice(0, 100),
    }).onConflictDoNothing();
    deps.log.info({ deviceId, via, claimCode: udpClaimCode(name) }, "udp json: пристрій зареєстровано");
    return "ok";
  }

  return {
    sock,
    close: () => new Promise<void>((r) => sock.close(() => r())),
    list: (): UdpSenderInfo[] => [...seen.values()].map((t) => ({
      deviceId: t.deviceId, name: t.name, ip: t.ip, via: t.via, packets: t.packets, rejected: t.rejected,
      lastAt: t.lastAt ? new Date(t.lastAt).toISOString() : "", lastError: t.lastError,
    })),
  };
}
