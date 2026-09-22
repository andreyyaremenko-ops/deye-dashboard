/**
 * OpenAI (GPT Image): фото страв — POST /v1/images/generations.
 * На відміну від Grok уміє справжнє прозоре тло (background: transparent -> PNG з альфою).
 * Оплата за токенами: у відповіді лише usage, тож вартість рахуємо за OPENAI_IMAGE_PRICING
 * ($ за 1M токенів * токени = мільйонні долара).
 */
import { OPENAI_IMAGE_PRICING } from "@deye/shared/menu-ai";
import type { AiUsage, GenerateOptions, ImageProvider } from "./types.ts";
import { postJson } from "./http.ts";

export interface OpenAiOptions {
  apiKey: string;
  api?: string;
  imageModel?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

interface OpenAiUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
}

/** Вартість генерації в мікродоларах за токенами з відповіді. Невідома модель — за найдорожчим тарифом. */
export function openAiCostMicros(model: string, u: OpenAiUsage | undefined): number {
  const price = OPENAI_IMAGE_PRICING[model] ?? { textIn: 5, imageOut: 40 };
  const textIn = u?.input_tokens_details?.text_tokens ?? u?.input_tokens ?? 0;
  return Math.round(textIn * price.textIn + (u?.output_tokens ?? 0) * price.imageOut);
}

export class OpenAiProvider implements ImageProvider {
  readonly provider = "openai";
  private readonly o: Required<Omit<OpenAiOptions, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(opts: OpenAiOptions) {
    this.o = {
      apiKey: opts.apiKey,
      api: opts.api ?? "https://api.openai.com",
      imageModel: opts.imageModel ?? "gpt-image-2",
      timeoutMs: opts.timeoutMs ?? 180_000,        // high-якість малює довше за Grok
      retries: opts.retries ?? 2,
      fetchImpl: opts.fetchImpl ?? fetch,
    };
  }

  async generate(prompt: string, n: number, opts: GenerateOptions = {}) {
    const model = opts.model ?? this.o.imageModel;
    const body = await postJson(`${this.o.api}/v1/images/generations`, {
      model, prompt, n,
      size: "1024x1024",
      quality: opts.quality ?? "medium",
      background: opts.alpha ? "transparent" : "opaque",
      // прозорість живе лише в png/webp; інакше jpeg — менший і його все одно перекодуємо
      output_format: opts.alpha ? "png" : "jpeg",
    }, { ...this.o, label: "openai" });
    const data = (body.data ?? []) as { b64_json?: string }[];
    const mime = opts.alpha ? "image/png" : "image/jpeg";
    const images = data.filter((d) => d.b64_json).map((d) => ({ data: Buffer.from(d.b64_json!, "base64"), mime }));
    if (!images.length) throw new Error("openai: зображень не повернуто");
    const u: OpenAiUsage = body.usage ?? {};
    const usage: AiUsage = {
      provider: this.provider, model,
      tokensIn: u.input_tokens ?? 0, tokensOut: u.output_tokens ?? 0, images: images.length, costMicros: openAiCostMicros(model, u),
    };
    return { images, usage };
  }
}
