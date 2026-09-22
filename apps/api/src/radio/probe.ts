/**
 * Перевірка радіостріму, який додає клієнт: чи це справді аудіо, яке зіграє браузер ТБ.
 * Плейлисти .m3u/.pls розгортаються до першого стріму; HLS і сторінки сайтів відхиляються з поясненням.
 *
 * Сервер сам ходить за чужою адресою, тому захист від SSRF: лише https, жодних приватних/локальних IP
 * (перевіряється на кожному редиректі), відповідь клієнту — лише тип і назва, не тіло.
 */
import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

export interface ProbeResult {
  /** прямий стрім (після розгортання плейлиста і редиректів) */
  url: string;
  contentType: string;
  /** icy-name зі стріму: підказка для назви */
  name: string | null;
}

export class ProbeError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export type Lookup = (host: string) => Promise<string[]>;
export interface ProbeOptions { fetchImpl?: typeof fetch; lookup?: Lookup; timeoutMs?: number }

const BLOCKED = new BlockList();
for (const [a, p] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) BLOCKED.addSubnet(a, p, "ipv4");
for (const [a, p] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) BLOCKED.addSubnet(a, p, "ipv6");

/** Приватна, локальна чи службова адреса (включно з IPv4-mapped IPv6). */
export function isPrivateIp(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return BLOCKED.check(mapped[1]!, "ipv4");
  const v = isIP(ip);
  if (!v) return true;
  return BLOCKED.check(ip, v === 4 ? "ipv4" : "ipv6");
}

/** Заголовки приходять як latin1; Icecast шле icy-name у UTF-8 — перекодовуємо, якщо байти валідні. */
export function decodeHeader(v: string | null): string | null {
  const t = v?.trim();
  if (!t) return null;
  if (![...t].every((c) => c.charCodeAt(0) < 256)) return t;
  const utf8 = Buffer.from(t, "latin1").toString("utf8");
  return utf8.includes("\uFFFD") ? t : utf8;
}

const defaultLookup: Lookup = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address);

async function assertPublic(url: URL, lookup: Lookup) {
  if (url.protocol !== "https:") {
    throw new ProbeError("not_https", "Потрібна адреса https://: екран на ТБ відкривається по https, і браузер заблокує звук з http");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : await lookup(host).catch(() => { throw new ProbeError("dns", `Не вдалося знайти сервер ${host}`); });
  if (!ips.length || ips.some(isPrivateIp)) throw new ProbeError("private", "Адреса веде у внутрішню мережу — такі станції додавати не можна");
}

const PLAYLIST_TYPES = /^(audio\/(x-)?mpegurl|audio\/(x-)?scpls|application\/pls\+xml|audio\/x-pn-realaudio)$/i;
const HLS_TYPES = /^application\/(vnd\.apple\.mpegurl|x-mpegurl)$/i;
const AUDIO_TYPES = /^(audio\/|application\/ogg$)/i;

/** Перша http(s)-адреса з плейлиста .m3u/.pls. */
export function firstStreamFromPlaylist(body: string): string | null {
  if (/#EXT-X-/i.test(body)) throw new ProbeError("hls", "Це HLS (m3u8): більшість телевізорів його не грає — потрібен прямий mp3/aac-стрім");
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    const m = /^(?:File\d+\s*=\s*)?(https?:\/\/\S+)$/i.exec(t);
    if (m) return m[1]!;
  }
  return null;
}

async function readText(res: Response, max = 64 * 1024): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); n += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8").slice(0, max);
}

export async function probeStream(input: string, opts: ProbeOptions = {}, depth = 0): Promise<ProbeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const lookup = opts.lookup ?? defaultLookup;
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new ProbeError("bad_url", "Це не схоже на адресу стріму"); }

  // редиректи вручну: кожен крок перевіряємо на приватні адреси
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url, lookup);
    try {
      res = await fetchImpl(url, {
        redirect: "manual",
        headers: { "user-agent": "SunHunterTV/1.0 (radio check)", "icy-metadata": "0" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      });
    } catch {
      throw new ProbeError("unreachable", "Сервер станції не відповідає — перевірте адресу");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get("location")!, url);
      res = null;
      continue;
    }
    break;
  }
  if (!res) throw new ProbeError("redirects", "Забагато переадресацій");
  if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new ProbeError("http_status", `Станція відповіла помилкою ${res.status}`); }

  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const name = decodeHeader(res.headers.get("icy-name"))?.slice(0, 60) ?? null;
  const path = url.pathname.toLowerCase();

  if (HLS_TYPES.test(type) || path.endsWith(".m3u8")) {
    await res.body?.cancel().catch(() => {});
    throw new ProbeError("hls", "Це HLS (m3u8): більшість телевізорів його не грає — потрібен прямий mp3/aac-стрім");
  }
  // плейлист (.m3u/.pls): розгортаємо до стріму, один рівень вкладення
  if (PLAYLIST_TYPES.test(type) || /\.(m3u|pls)$/.test(path)) {
    const next = firstStreamFromPlaylist(await readText(res));
    if (!next) throw new ProbeError("empty_playlist", "У плейлисті немає посилання на стрім");
    if (depth > 0) throw new ProbeError("nested_playlist", "Плейлист посилається на інший плейлист — вкажіть прямий стрім");
    const inner = await probeStream(next, opts, depth + 1);
    return { ...inner, name: inner.name ?? name };
  }
  if (AUDIO_TYPES.test(type)) {
    await res.body?.cancel().catch(() => {});
    return { url: url.toString(), contentType: type, name };
  }
  await res.body?.cancel().catch(() => {});
  if (type === "text/html") throw new ProbeError("html", "Це сторінка сайту, а не стрім. Потрібне пряме посилання на потік (зазвичай закінчується на .mp3, /stream або /live)");
  throw new ProbeError("not_audio", `За цією адресою не аудіо (${type || "тип не вказано"})`);
}
