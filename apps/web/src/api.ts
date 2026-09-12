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
  inverterSerial: string | null; inverterType: number | null; modelId: string | null; stickSerial: number | null;
  state: Record<string, number | string | boolean> | null; stateUpdatedAt: string | null; stale: boolean;
}
export interface Screen { id: string; orgId: string; name: string; config: ScreenConfig; viewToken: string; createdAt: string; updatedAt: string }
export type { RadioStation };

export const screenUrl = (token: string) => `${location.origin}/s/${token}`;
