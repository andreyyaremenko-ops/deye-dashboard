import { useState, type ReactNode, type FormEvent } from "react";
import { ApiError } from "../api.ts";

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="card"><div className="card-h">{title && <h2>{title}</h2>}<div className="grow" />{actions}</div>{children}</section>;
}
export function Btn({ children, onClick, kind = "default", type = "button", disabled, title }:
  { children: ReactNode; onClick?: () => void; kind?: "default" | "primary" | "danger" | "ghost"; type?: "button" | "submit"; disabled?: boolean; title?: string }) {
  return <button type={type} className={`btn btn-${kind}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function ErrorBox({ err }: { err: unknown }) {
  if (!err) return null;
  const msg = err instanceof ApiError ? humanize(err) : err instanceof Error ? err.message : String(err);
  return <div className="error">{msg}</div>;
}
function humanize(e: ApiError): string {
  const map: Record<string, string> = {
    plan_limit: "Ліміт тарифу: більше екранів чи логерів доступно в Pro",
    already_claimed: "Пристрій уже привʼязаний до іншої організації",
    not_found: e.message.includes("code") ? "Пристрій з таким кодом не знайдено" : "Не знайдено",
    last_owner: "Це останній власник, його не можна прибрати",
    invite_used: "Запрошення вже використане",
    invite_expired: "Запрошення прострочене",
    already_member: "Ви вже учасник цієї організації",
    forbidden: "Недостатньо прав",
    unauthorized: "Потрібно увійти",
  };
  return map[e.code] ?? e.message;
}
/** Проста форма з локальним станом помилки/зайнятості. */
export function useAction<T>(fn: (arg: T) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const run = async (arg: T) => { setBusy(true); setErr(null); try { await fn(arg); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return { busy, err, run };
}
export function onSubmit(fn: () => void) {
  return (e: FormEvent) => { e.preventDefault(); fn(); };
}
export const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString("uk-UA") : "—");
export const ago = (s: string | null) => {
  if (!s) return "ніколи";
  const d = (Date.now() - Date.parse(s)) / 1000;
  return d < 60 ? `${Math.round(d)} с тому` : d < 3600 ? `${Math.round(d / 60)} хв тому` : d < 86400 ? `${Math.round(d / 3600)} год тому` : fmtDate(s);
};
