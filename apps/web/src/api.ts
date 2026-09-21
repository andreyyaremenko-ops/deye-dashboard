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
  put: <T>(u: string, b: unknown) => req<T>("PUT", u, b),
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
  id: string; orgId: string | null; name: string; category: string | null; status: "uploaded" | "processing" | "ready" | "failed"; kind: "video" | "image";
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

// --- AI-меню ---
export interface MenuSummary {
  id: string; name: string; status: "importing" | "draft" | "published"; styleId: string | null;
  publishedAt: string | null; createdAt: string; updatedAt: string; items: number;
}
export interface DishImage {
  id: string; itemId: string | null; status: "queued" | "ready" | "failed"; file: string | null; thumb: string | null;
  isAi: boolean; provider: string | null; model: string | null; prompt: string | null; createdAt: string;
}
export interface MenuItem {
  id: string; menuId: string; sectionId: string; name: string; description: string | null; price: number | null;
  volume: string | null; sort: number; inStock: boolean; imageId: string | null; imageIsAi: boolean;
  confidence: number | null; images?: DishImage[];
}
export interface MenuSection { id: string; menuId: string; name: string; sort: number; items: MenuItem[] }
export interface MenuTree extends MenuSummary { sections: MenuSection[] }
export interface MenuStyleRow { id: string | null; name: string; prompt: string; bgMode: string; bgColor: string | null }
export interface ImportState {
  menu: { id: string; name: string; status: MenuSummary["status"] };
  job: { id: string; status: "queued" | "running" | "done" | "failed"; error: string | null; attempts: number; createdAt: string; finishedAt: string | null } | null;
}
export interface DishImages { itemId: string; chosen: string | null; imageIsAi: boolean; images: DishImage[]; job: { id: string; status: string; error: string | null } | null }
export interface AiUsage {
  imagesMonth: number; dishesWithAi: number; calls: number; costMicros: number;
  limits: { aiDishes: number; aiGenerationsMonth: number };
  remaining: { images: number; dishes: number };
}

/** Фото страви й фото меню роздає Caddy з /media. */
export const mediaUrl = (path: string) => `/media/${path}`;

/** 1–5 фото паперового меню одним запитом; прогрес — бо файли з телефона великі. */
export function importMenuPhotos(orgId: string, name: string, files: File[], onProgress: (pct: number) => void) {
  return new Promise<{ menuId: string; jobId: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/orgs/${orgId}/menus/import`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      const data = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error ?? "error", data.message ?? xhr.statusText));
    };
    xhr.onerror = () => reject(new Error("Помилка мережі"));
    const fd = new FormData();
    fd.append("name", name);
    for (const f of files) fd.append("files", f);
    xhr.send(fd);
  });
}

export async function uploadDishPhoto(orgId: string, menuId: string, itemId: string, file: File) {
  const fd = new FormData(); fd.append("file", file);
  const r = await fetch(`/api/orgs/${orgId}/menus/${menuId}/items/${itemId}/images/upload`, { method: "POST", body: fd, credentials: "same-origin" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error ?? "error", data.message ?? r.statusText);
  return data as { jobId: string; itemId: string };
}
