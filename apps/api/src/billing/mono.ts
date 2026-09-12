/**
 * monobank acquiring: створення рахунку, статус, публічний ключ, перевірка підпису вебхука.
 * Спека: https://api.monobank.ua/docs/acquiring.html. Суми в копійках.
 */
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

export interface MonoInvoice { invoiceId: string; pageUrl: string }
export type MonoStatus = "created" | "processing" | "hold" | "success" | "failure" | "reversed" | "expired";
export interface MonoInvoiceStatus {
  invoiceId: string; status: MonoStatus; amount?: number; ccy?: number; finalAmount?: number; reference?: string;
  failureReason?: string; errCode?: string; createdDate?: string; modifiedDate?: string;
  paymentInfo?: { maskedPan?: string; paymentSystem?: string; paymentMethod?: string; fee?: number };
}

export interface MonoClient {
  createInvoice(input: { amount: number; reference: string; destination: string; redirectUrl: string; webHookUrl: string; validitySec?: number; basket?: { name: string; qty: number; sum: number; code: string }[] }): Promise<MonoInvoice>;
  getStatus(invoiceId: string): Promise<MonoInvoiceStatus>;
  getPubKey(): Promise<string>;   // PEM
}

export function createMonoClient(token: string, base = "https://api.monobank.ua", fetchFn: typeof fetch = fetch): MonoClient {
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetchFn(base + path, { ...init, headers: { "X-Token": token, "Content-Type": "application/json", "X-Cms": "sunhunter-tv", ...(init.headers ?? {}) } });
    const text = await r.text();
    if (!r.ok) throw new Error(`mono ${path} ${r.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  let pubKeyCache: { pem: string; at: number } | null = null;
  return {
    async createInvoice(i) {
      const body = {
        amount: i.amount, ccy: 980,
        merchantPaymInfo: { reference: i.reference, destination: i.destination, comment: i.destination, basketOrder: i.basket },
        redirectUrl: i.redirectUrl, webHookUrl: i.webHookUrl, validity: i.validitySec ?? 3600 * 24, paymentType: "debit",
      };
      return call("/api/merchant/invoice/create", { method: "POST", body: JSON.stringify(body) });
    },
    getStatus: (id) => call(`/api/merchant/invoice/status?invoiceId=${encodeURIComponent(id)}`),
    async getPubKey() {
      if (pubKeyCache && Date.now() - pubKeyCache.at < 6 * 3600_000) return pubKeyCache.pem;
      const { key } = (await call("/api/merchant/pubkey")) as { key: string };
      const pem = Buffer.from(key, "base64").toString("utf8");
      pubKeyCache = { pem, at: Date.now() };
      return pem;
    },
  };
}

/** X-Sign: base64(ECDSA-SHA256 підпис сирого тіла). Ключ — PEM (x.509 SubjectPublicKeyInfo). */
export function verifyMonoSignature(rawBody: Buffer | string, xSign: string, pem: string): boolean {
  try {
    const key = createPublicKey(pem);
    return cryptoVerify("sha256", Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody), key, Buffer.from(xSign, "base64"));
  } catch { return false; }
}
