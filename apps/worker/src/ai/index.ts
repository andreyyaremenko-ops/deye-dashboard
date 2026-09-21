/**
 * Вибір провайдера за env. Без XAI_API_KEY AI-задачі не беруться з черги
 * (лишаються queued), тож локальна розробка без ключа нічого не ламає.
 */
import { GrokProvider } from "./grok.ts";
import type { AiProviders } from "./types.ts";

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): AiProviders {
  const apiKey = env.XAI_API_KEY;
  if (!apiKey) return { vision: null, image: null };
  const p = new GrokProvider({
    apiKey,
    api: env.XAI_API,
    visionModel: env.AI_VISION_MODEL,
    imageModel: env.AI_IMAGE_MODEL,
    timeoutMs: env.AI_TIMEOUT_MS ? Number(env.AI_TIMEOUT_MS) : undefined,
  });
  return { vision: p, image: p };
}

export * from "./types.ts";
export { GrokProvider } from "./grok.ts";
