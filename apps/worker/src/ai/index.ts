/**
 * Провайдери за env: XAI_API_KEY — розпізнавання меню і фото Grok, OPENAI_API_KEY — фото GPT Image.
 * Без ключів відповідні задачі не беруться з черги (лишаються queued), локальна розробка не ламається.
 */
import { GrokProvider } from "./grok.ts";
import { OpenAiProvider } from "./openai.ts";
import type { AiProviders } from "./types.ts";

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): AiProviders {
  const timeoutMs = env.AI_TIMEOUT_MS ? Number(env.AI_TIMEOUT_MS) : undefined;
  const out: AiProviders = { vision: null, images: {} };
  if (env.XAI_API_KEY) {
    const grok = new GrokProvider({ apiKey: env.XAI_API_KEY, api: env.XAI_API, visionModel: env.AI_VISION_MODEL, imageModel: env.AI_IMAGE_MODEL, timeoutMs });
    out.vision = grok;
    out.images.xai = grok;
  }
  if (env.OPENAI_API_KEY) out.images.openai = new OpenAiProvider({ apiKey: env.OPENAI_API_KEY, api: env.OPENAI_API });
  return out;
}

export * from "./types.ts";
export { GrokProvider } from "./grok.ts";
export { OpenAiProvider } from "./openai.ts";
