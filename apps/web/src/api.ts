/** Клієнт API кабінету. Cookie-сесія Better Auth, JSON, помилки як ApiError. */
import type { ScreenConfig, OrgRole, PlanLimits, RadioStation } from "@deye/shared";

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method, credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error ?? "error", data.message ?? r.statusText);
  return data as T;
}
export const api = {
  get: <T>(u: string) => req<T>("GET", u),
  post: <T>(u: string, b?: unknown) => req<T>("POST", u, b ?? {}),
  patch: <T>(u: string, b: unknown) => req<T>("PATCH", u, b),
  del: <T>(u: string) => req<T>("DELETE", u),
};

export interface Me { user: { id: string; email: string; name: string; isSuperadmin: boolean }; orgs: OrgSummary[] }
export interface OrgSummary { id: string; name: string; planId: string; role: OrgRole }
export interface Org { id: string; name: string; planId: string; role: OrgRole; plan: { id: string; name: string; limits: PlanLimits } }
export interface Member { userId: string; email: string; name: string | null; role: OrgRole; since: string }
export interface Invite { id: string; role: OrgRole; expiresAt: string; usedAt: string | null }
export interface Device {
  id: string; name: string | null; hw: string | null; fw: string | null; online: boolean; lastSeenAt: string | null;
  inverterSerial: string | null; inverterType: number | null; modelId: string | null; stickSerial: number | null; batteryKwh: number | null; minSoc: number; pvKwp: number | null;
  state: Record<string, number | string | boolean> | null; stateUpdatedAt: string | null; stale: boolean;
}
export interface Screen { id: string; orgId: string; name: string; config: ScreenConfig; viewToken: string; createdAt: string; updatedAt: string; lastViewedAt: string | null; viewers?: number; tvs?: { device: string; ip: string; since: string }[] }
export interface Background {
  id: string; orgId: string | null; name: string; category: string | null; status: "uploaded" | "processing" | "ready" | "failed";
  files: Record<"1080" | "720", string> | null; preview: string | null; attribution: string | null; license: string | null; durationS: number | null; createdAt: string;
}
export type { RadioStation };

/** Завантаження з прогресом (fetch не дає upload progress). */
export function uploadBackground(orgId: string, file: File, onProgress: (pct: number) => void): Promise<Background> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/orgs/${orgId}/backgrounds`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      const data = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Background);
      else reject(new ApiError(xhr.status, data.error ?? "error", data.message ?? xhr.statusText));
    };
    xhr.onerror = () => reject(new Error("Помилка мережі"));
    const fd = new FormData(); fd.append("file", file);
    xhr.send(fd);
  });
}

export const screenUrl = (token: string) => `${location.origin}/s/${token}`;

export interface Billing {
  enabled: boolean; planId: string; planUntil: string | null; months: number[];
  options: { months: number; amount: number; freeMonths: number }[];
  plans: { id: string; name: string; priceMonth: number | null; limits: PlanLimits }[];
  payments: { id: string; planId: string; months: number; amount: number; status: string; createdAt: string; appliedAt: string | null; pageUrl: string | null }[];
}
