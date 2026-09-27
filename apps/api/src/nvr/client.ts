/**
 * Клієнт до NVR закладу (HTTP API відеореєстратора). Ключ — Bearer, живе лише на сервері.
 * `live` віддає підписане HLS-посилання на добу; воно на домені NVR, який може бути закритий
 * для сторонніх IP, тому телевізор ходить не туди, а в наш проксі (див. nvr/service.ts).
 */
export type NvrErrorCode = "unreachable" | "auth" | "not_found" | "bad_response";
export class NvrError extends Error {
  code: NvrErrorCode;
  constructor(message: string, code: NvrErrorCode) { super(message); this.code = code; }
}

export interface NvrCamera { id: string; online: boolean; substream: boolean }
export interface NvrLive { camera: string; quality: string; hlsUrl: string; expiresAt: string }

const TIMEOUT_MS = 10_000;

/** Нормалізує адресу NVR: лише https/http, без хвостового слеша і без шляху /api. */
export function normalizeBaseUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new NvrError("Адреса NVR некоректна", "bad_response"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new NvrError("Адреса NVR має починатись з https://", "bad_response");
  return `${u.protocol}//${u.host}`;
}

async function call<T>(baseUrl: string, token: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new NvrError("NVR не відповідає", "unreachable");
  }
  if (res.status === 401 || res.status === 403) throw new NvrError("NVR не прийняв ключ", "auth");
  if (res.status === 404) throw new NvrError("NVR не знає такої камери", "not_found");
  if (!res.ok) throw new NvrError(`NVR відповів ${res.status}`, "bad_response");
  try { return (await res.json()) as T; } catch { throw new NvrError("NVR віддав не JSON", "bad_response"); }
}

export async function listCameras(baseUrl: string, token: string): Promise<NvrCamera[]> {
  const j = await call<{ cameras?: unknown }>(baseUrl, token, "/api/v1/cameras");
  if (!Array.isArray(j.cameras)) throw new NvrError("NVR віддав список камер у невідомому форматі", "bad_response");
  return j.cameras.map((c) => {
    const o = c as Record<string, unknown>;
    if (typeof o.id !== "string") throw new NvrError("NVR віддав камеру без id", "bad_response");
    return { id: o.id, online: o.online === true, substream: o.substream === true };
  });
}

export async function liveUrl(baseUrl: string, token: string, camera: string): Promise<NvrLive> {
  const j = await call<{ camera?: string; quality?: string; hls_url?: string; expires_at?: string }>(
    baseUrl, token, `/api/v1/cameras/${encodeURIComponent(camera)}/live`);
  if (typeof j.hls_url !== "string") throw new NvrError("NVR не віддав hls_url", "bad_response");
  return { camera: j.camera ?? camera, quality: j.quality ?? "", hlsUrl: j.hls_url, expiresAt: j.expires_at ?? "" };
}

export type NvrClient = { listCameras: typeof listCameras; liveUrl: typeof liveUrl };
export const httpNvrClient: NvrClient = { listCameras, liveUrl };
