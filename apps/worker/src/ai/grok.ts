/**
 * xAI (Grok): читання меню з фото — POST /v1/responses, фото страв — POST /v1/images/generations.
 * Ключ лише на сервері (XAI_API_KEY), таймаут і повтори на 429/5xx.
 * Вартість беремо з відповіді: usage.cost_in_usd_ticks, 1 USD = 1e10 «тіків».
 */
import type { AiInputImage, AiUsage, GenerateOptions, ImageProvider, VisionProvider } from "./types.ts";
import { postJson } from "./http.ts";

const TICKS_PER_USD = 1e10;

export interface GrokOptions {
  apiKey: string;
  api?: string;
  visionModel?: string;
  imageModel?: string;
  timeoutMs?: number;
  retries?: number;
  /** для тестів */
  fetchImpl?: typeof fetch;
}

interface XaiUsage { cost_in_usd_ticks?: number; input_tokens?: number; output_tokens?: number }

export const costMicrosOf = (u: XaiUsage | undefined): number =>
  Math.round(((u?.cost_in_usd_ticks ?? 0) / TICKS_PER_USD) * 1_000_000);

/** Текст відповіді Responses API: усі частини output_text по порядку. */
export function outputText(body: unknown): string {
  const out = (body as { output?: { content?: { type?: string; text?: string }[] }[] }).output ?? [];
  const parts: string[] = [];
  for (const msg of out) for (const c of msg.content ?? []) if (c.type === "output_text" && c.text) parts.push(c.text);
  return parts.join("\n").trim();
}

export class GrokProvider implements VisionProvider, ImageProvider {
  readonly provider = "xai";
  private readonly o: Required<Omit<GrokOptions, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(opts: GrokOptions) {
    this.o = {
      apiKey: opts.apiKey,
      api: opts.api ?? "https://api.x.ai",
      visionModel: opts.visionModel ?? "grok-4.7",
      imageModel: opts.imageModel ?? "grok-imagine-image-2.0",
      timeoutMs: opts.timeoutMs ?? 120_000,
      retries: opts.retries ?? 2,
      fetchImpl: opts.fetchImpl ?? fetch,
    };
  }

  private call(path: string, body: unknown): Promise<any> {
    return postJson(`${this.o.api}${path}`, body, { ...this.o, label: "xai" });
  }

  async readMenu(images: AiInputImage[], prompt: { system: string; user: string }) {
    const content: unknown[] = images.map((i) => ({ type: "input_image", image_url: `data:${i.mime};base64,${i.data.toString("base64")}` }));
    content.push({ type: "input_text", text: `${prompt.system}\n\n${prompt.user}` });
    const body = await this.call("/v1/responses", {
      model: this.o.visionModel,
      input: [{ role: "user", content }],
      max_output_tokens: 16_000,
      temperature: 0,
    });
    const raw = outputText(body);
    if (!raw) throw new Error("xai: порожня відповідь");
    const u: XaiUsage = body.usage ?? {};
    const usage: AiUsage = {
      provider: this.provider, model: this.o.visionModel,
      tokensIn: u.input_tokens ?? 0, tokensOut: u.output_tokens ?? 0, images: 0, costMicros: costMicrosOf(u),
    };
    return { raw, usage };
  }

  /** Grok не вміє прозоре тло і вибір якості — opts.alpha/quality ігноруються. */
  async generate(prompt: string, n: number, opts: GenerateOptions = {}) {
    const model = opts.model ?? this.o.imageModel;
    const body = await this.call("/v1/images/generations", {
      model, prompt, n, aspect_ratio: "1:1", resolution: "1k", response_format: "b64_json",
    });
    const data = (body.data ?? []) as { b64_json?: string; url?: string; mime_type?: string }[];
    const images = [];
    for (const d of data) {
      if (d.b64_json) images.push({ data: Buffer.from(d.b64_json, "base64"), mime: d.mime_type ?? "image/jpeg" });
      else if (d.url) {
        const r = await this.o.fetchImpl(d.url, { signal: AbortSignal.timeout(this.o.timeoutMs) });
        if (!r.ok) throw new Error(`xai: не вдалось завантажити зображення (${r.status})`);
        images.push({ data: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") ?? "image/jpeg" });
      }
    }
    if (!images.length) throw new Error("xai: зображень не повернуто");
    const u: XaiUsage = body.usage ?? {};
    const usage: AiUsage = {
      provider: this.provider, model,
      tokensIn: u.input_tokens ?? 0, tokensOut: u.output_tokens ?? 0, images: images.length, costMicros: costMicrosOf(u),
    };
    return { images, usage };
  }
}
