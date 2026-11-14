/**
 * Чи йде трансляція зараз: питаємо API MediaMTX (лише в docker-мережі, назовні не відкритий) про <id>/tv —
 * саме цю версію грають екрани. Відповідь кешуємо на кілька секунд: опитують усі телевізори з віджетом.
 */
import { MTX_INTERNAL_USER } from "./service.ts";

const TTL_MS = 3000;
const TIMEOUT_MS = 2000;

export type LiveOnline = (pathId: string) => Promise<boolean>;

export function mediamtxStatus(apiBase: string, internalPass: string, call: typeof fetch = fetch): LiveOnline {
  const cache = new Map<string, { at: number; online: Promise<boolean> }>();
  const auth = `Basic ${Buffer.from(`${MTX_INTERNAL_USER}:${internalPass}`).toString("base64")}`;
  return (pathId) => {
    const hit = cache.get(pathId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.online;
    const online = call(`${apiBase}/v3/paths/get/${pathId}/tv`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then(async (r) => (r.ok ? !!((await r.json()) as { online?: boolean }).online : false))
      .catch(() => false);
    cache.set(pathId, { at: Date.now(), online });
    if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at >= TTL_MS) cache.delete(k);
    return online;
  };
}
