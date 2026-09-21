/**
 * Контракт AI-провайдерів. Реалізація — grok.ts (xAI); підмінити на інший провайдер
 * означає написати лише новий файл із цими двома інтерфейсами.
 */
export interface AiInputImage { data: Buffer; mime: string }
export interface AiOutputImage { data: Buffer; mime: string }

/** Скільки коштував виклик: пишемо в ai_usage для лімітів і обліку. */
export interface AiUsage {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  images: number;
  /** мільйонні долара */
  costMicros: number;
}

export interface VisionProvider {
  /** Фото меню -> сирий текст відповіді (розбирає @deye/shared/menu-ai). */
  readMenu(images: AiInputImage[], prompt: { system: string; user: string }): Promise<{ raw: string; usage: AiUsage }>;
}

export interface ImageProvider {
  /** n варіантів фото страви, квадрат 1:1. */
  generate(prompt: string, n: number): Promise<{ images: AiOutputImage[]; usage: AiUsage }>;
}

export interface AiProviders { vision: VisionProvider | null; image: ImageProvider | null }
