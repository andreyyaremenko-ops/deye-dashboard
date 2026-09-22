import { track } from "../analytics.ts";
import { useEffect, useState } from "react";
import { orgRoles, type OrgRole } from "@deye/shared";
import { api, type Billing, type Invite, type Member, type Org } from "../api.ts";
import { Btn, Card, ErrorBox, Field, fmtDate, useAction } from "../components/ui.tsx";

const ROLE: Record<OrgRole, string> = { owner: "власник", admin: "адмін", staff: "персонал" };

export function Members({ org, meId }: { org: Org; meId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [role, setRole] = useState<OrgRole>("staff");
  const isOwner = org.role === "owner", isAdmin = org.role !== "staff";
  const load = async () => { setMembers(await api.get(`/api/orgs/${org.id}/members`)); if (isAdmin) setInvites(await api.get(`/api/orgs/${org.id}/invites`)); };
  useEffect(() => { void load(); }, [org.id]);

  const invite = useAction(async () => { const r = await api.post<{ url: string }>(`/api/orgs/${org.id}/invites`, { role }); setLink(r.url); await load(); });
  const revoke = useAction(async (id: string) => { await api.del(`/api/orgs/${org.id}/invites/${id}`); await load(); });
  const remove = useAction(async (m: Member) => { if (confirm(`Прибрати ${m.email}?`)) { await api.del(`/api/orgs/${org.id}/members/${m.userId}`); await load(); } });
  const change = useAction(async ({ m, r }: { m: Member; r: OrgRole }) => { await api.patch(`/api/orgs/${org.id}/members/${m.userId}`, { role: r }); await load(); });

  return <>
    <Card title="Учасники">
      <ErrorBox err={remove.err ?? change.err} />
      <table className="tbl"><thead><tr><th>Email</th><th>Імʼя</th><th>Роль</th><th>З</th><th></th></tr></thead><tbody>
        {members.map((m) => <tr key={m.userId}>
          <td data-l="Email">{m.email}{m.userId === meId && <span className="muted"> (ви)</span>}</td><td data-l="Імʼя">{m.name}</td>
          <td data-l="Роль">{isOwner ? <select value={m.role} onChange={(e) => change.run({ m, r: e.currentTarget.value as OrgRole })}>{orgRoles.map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select> : ROLE[m.role]}</td>
          <td data-l="З" className="muted small">{fmtDate(m.since)}</td>
          <td className="actions">{isOwner && <Btn kind="ghost" onClick={() => remove.run(m)}>Прибрати</Btn>}</td>
        </tr>)}
      </tbody></table>
    </Card>
    {isAdmin && <Card title="Запросити">
      <p className="muted small">Одноразове посилання, діє 72 години. Перегляд екрана прав не дає, а запрошення екран не показує.</p>
      <div className="row">
        <select value={role} onChange={(e) => setRole(e.currentTarget.value as OrgRole)}>
          <option value="staff">персонал</option><option value="admin">адмін</option>{isOwner && <option value="owner">власник</option>}
        </select>
        <Btn kind="primary" onClick={() => invite.run(undefined)} disabled={invite.busy}>Створити посилання</Btn>
      </div>
      <ErrorBox err={invite.err ?? revoke.err} />
      {link && <div className="ok"><code className="wrap">{link}</code><Btn kind="ghost" onClick={() => navigator.clipboard?.writeText(link)}>Копіювати</Btn></div>}
      {invites.filter((i) => !i.usedAt).length > 0 && <table className="tbl small"><thead><tr><th>Роль</th><th>Діє до</th><th></th></tr></thead><tbody>
        {invites.filter((i) => !i.usedAt).map((i) => <tr key={i.id}><td data-l="Роль">{ROLE[i.role]}</td><td data-l="Діє до">{fmtDate(i.expiresAt)}</td><td className="actions"><Btn kind="ghost" onClick={() => revoke.run(i.id)}>Відкликати</Btn></td></tr>)}
      </tbody></table>}
    </Card>}
  </>;
}

const STATUS_UA: Record<string, string> = { created: "очікує оплати", processing: "обробляється", hold: "заблоковано", success: "оплачено", failure: "не пройшла", reversed: "повернено", expired: "прострочена" };
const uah = (kop: number) => `${(kop / 100).toLocaleString("uk-UA")} ₴`;

export function Settings({ org, onPlanChange }: { org: Org; onPlanChange?: () => void }) {
  const L = org.plan.limits;
  const [b, setB] = useState<Billing | null>(null);
  const [months, setMonths] = useState(1);
  const [result, setResult] = useState<string | null>(null);
  const load = async () => setB(await api.get<Billing>(`/api/orgs/${org.id}/billing`));
  useEffect(() => { void load(); }, [org.id]);
  // повернення з monobank: ?payment=<id> — опитуємо статус кілька разів
  useEffect(() => {
    const pid = new URLSearchParams(location.search).get("payment");
    if (!pid) return;
    let tries = 0; let stop = false;
    const poll = async () => {
      const p = await api.get<{ status: string }>(`/api/orgs/${org.id}/billing/payments/${pid}`).catch(() => null);
      if (stop) return;
      if (p && (p.status === "success" || p.status === "failure" || p.status === "expired" || p.status === "reversed")) {
        setResult(p.status === "success" ? "Оплата пройшла, тариф Pro активовано." : `Оплата не завершена: ${STATUS_UA[p.status] ?? p.status}.`);
        await load(); onPlanChange?.(); history.replaceState(null, "", location.pathname); return;
      }
      if (++tries < 15) setTimeout(poll, 2000); else setResult("Статус оплати ще уточнюється. Оновіть сторінку за хвилину.");
    };
    setResult("Перевіряємо оплату…"); void poll();
    return () => { stop = true; };
  }, [org.id]);
  const pay = useAction(async () => {
    const r = await api.post<{ pageUrl: string }>(`/api/orgs/${org.id}/billing/checkout`, { planId: "pro", months });
    track("begin_checkout", { currency: "UAH", value: (b?.options.find((o) => o.months === months)?.amount ?? 0) / 100, items: [{ item_id: "pro", item_name: "Pro", quantity: months }] });
    location.assign(r.pageUrl);
  });
  const pro = b?.plans.find((p) => p.id === "pro");
  const opt = b?.options.find((o) => o.months === months);
  const price = opt?.amount ?? 0;
  return <>
    <Card title="Організація">
      <p className="org-line"><b>{org.name}</b><span className={`plan-chip plan-${org.plan.id}`}>{org.plan.name}</span></p>
      <p className="muted small">Тариф {org.plan.name}{b?.planUntil && <span className="muted"> · оплачено до {fmtDate(b.planUntil)}</span>}</p>
      <div className="kpis">
        {[["Телевізорів", L.screens], ["Логерів", L.devices], ["Історія", L.history_days ? `${L.history_days} дн.` : "—"], ["Радіо", L.radio ? "так" : "—"], ["Власні радіостанції", L.custom_radio ?? 5], ["Власні фони", L.custom_backgrounds ? "так" : "—"], ["Брендинг на екрані", L.branding ? "є" : "немає"]].map(([l, v]) =>
          <div key={String(l)} className="kpi"><span className="muted small">{l}</span><b>{v}</b></div>)}
      </div>
    </Card>
    <Card title={org.plan.id === "pro" ? "Продовжити Pro" : "Перейти на Pro"}>
      {result && <div className={result.startsWith("Оплата пройшла") ? "ok" : "error"}>{result}</div>}
      {!b ? <p className="muted">Завантаження…</p> : !b.enabled ? <p className="muted">Онлайн-оплата ще не підключена. Напишіть нам, щоб активувати Pro.</p> : <>
        <p className="small muted">Pro: той самий функціонал на 5 телевізорів і 5 логерів, без брендингу на екрані. {pro?.priceMonth ? `${uah(pro.priceMonth)} на місяць` : ""}. Оплата карткою через monobank, термін додається до поточного.</p>
        <div className="row">
          <Field label="Період"><select value={months} onChange={(e) => setMonths(Number(e.currentTarget.value))}>{b.options.map((o) => <option key={o.months} value={o.months}>{o.months} міс.{o.freeMonths ? ` (${o.freeMonths} у подарунок)` : ""}</option>)}</select></Field>
          <div className="price-tag">{uah(price)}{opt?.freeMonths ? <span className="muted small"> замість {uah((pro?.priceMonth ?? 0) * months)}</span> : null}</div>
          {org.role === "owner" ? <Btn kind="primary" onClick={() => pay.run(undefined)} disabled={pay.busy}>{pay.busy ? "Створюємо рахунок…" : "Оплатити"}</Btn> : <span className="muted small">Оплатити може лише власник організації</span>}
        </div>
        <ErrorBox err={pay.err} />
      </>}
      {b && b.payments.length > 0 && <table className="tbl small" style={{ marginTop: ".8rem" }}><thead><tr><th>Дата</th><th>Тариф</th><th>Сума</th><th>Статус</th><th></th></tr></thead><tbody>
        {b.payments.map((p) => <tr key={p.id}><td data-l="Дата">{fmtDate(p.createdAt)}</td><td data-l="Тариф">{p.planId} · {p.months} міс.</td><td data-l="Сума">{uah(p.amount)}</td><td data-l="Статус">{STATUS_UA[p.status] ?? p.status}</td><td className="actions">{p.status === "created" && p.pageUrl && <a href={p.pageUrl} className="btn btn-ghost">Сплатити</a>}</td></tr>)}
      </tbody></table>}
    </Card>
  </>;
}
