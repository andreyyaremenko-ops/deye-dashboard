/** POST JSON до AI-провайдера: таймаут і повтори на 429/5xx/мережу з експоненційною паузою. */
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface PostOptions { apiKey: string; timeoutMs: number; retries: number; fetchImpl: typeof fetch; label: string }

export async function postJson(url: string, body: unknown, o: PostOptions): Promise<any> {
  let last: Error | null = null;
  for (let attempt = 0; attempt <= o.retries; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    let res: Response;
    try {
      res = await o.fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${o.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(o.timeoutMs),
      });
    } catch (e) {
      last = e as Error;            // мережа або таймаут — пробуємо ще раз
      continue;
    }
    if (res.ok) return res.json();
    const text = (await res.text().catch(() => "")).slice(0, 300);
    last = new Error(`${o.label} ${res.status}: ${text}`);
    if (!RETRY_STATUS.has(res.status)) break;
  }
  throw last ?? new Error(`${o.label}: no response`);
}
