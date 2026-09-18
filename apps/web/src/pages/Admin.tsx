import { Logo } from "../components/Logo.tsx";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Me } from "../api.ts";
import { Btn, Card, ErrorBox, ago, fmtDate, useAction } from "../components/ui.tsx";
import { authClient } from "../auth.ts";

interface OrgRow { id: string; name: string; planId: string; planUntil: string | null; createdAt: string; devices: number; online: number; screens: number; lastSeen: string | null; owners: string | null; paid: number }
interface Overview { orgs: OrgRow[]; totals: { orgs: number; users: number; devices: number; online: number; unclaimed: number; paidTotal: number; paid30d: number } }
interface DevRow { id: string; name: string | null; hw: string | null; fw: string | null; online: boolean; lastSeenAt: string | null; modelId: string | null; inverterSerial: string | null; stickSerial: number | null; fwChannel: string; orgId: string | null; orgName: string | null; createdAt: string }
interface PayRow { id: string; orgName: string | null; planId: string; months: number; amount: number; status: string; createdAt: string; appliedAt: string | null; invoiceId: string | null; failureReason: string | null }
const uah = (kop: number) => `${(kop / 100).toLocaleString("uk-UA")} ₴`;
const STATUS: Record<string, string> = { created: "очікує", processing: "обробка", hold: "холд", success: "оплачено", failure: "відмова", reversed: "повернуто", expired: "прострочено" };

interface ScreenRow { id: string; name: string; orgId: string; orgName: string; planId: string; updatedAt: string; lastViewedAt: string | null; widgets: number; radio: boolean; background: boolean; viewers: number; tvs: { device: string; ip: string; since: string }[] }

export function Admin({ me }: { me: Me }) {
  const [tab, setTab] = useState<"orgs" | "devices" | "screens" | "payments">("orgs");
  const [scr, setScr] = useState<ScreenRow[]>([]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [devs, setDevs] = useState<DevRow[]>([]);
  const [pays, setPays] = useState<PayRow[]>([]);
  const [edit, setEdit] = useState<{ id: string; planId: string; until: string } | null>(null);
  const load = async () => { setOv(await api.get<Overview>("/api/admin/overview")); setDevs(await api.get<DevRow[]>("/api/admin/devices/all")); setPays(await api.get<PayRow[]>("/api/admin/payments")); setScr(await api.get<ScreenRow[]>("/api/admin/screens")); };
  useEffect(() => { void load(); const t = setInterval(() => void load().catch(() => {}), 30_000); return () => clearInterval(t); }, []);
  const save = useAction(async () => {
    if (!edit) return;
    await api.patch(`/api/admin/orgs/${edit.id}/plan`, { planId: edit.planId, planUntil: edit.until ? new Date(edit.until).toISOString() : null });
    setEdit(null); await load();
  });
  if (!me.user.isSuperadmin) return <div className="auth"><p>Доступ лише для адміністратора платформи.</p></div>;
  const T = ov?.totals;
  return <div className="layout">
    <header className="top">
      <div className="top-row">
        <Link href="/" className="brand"><Logo />SunHunter TV · адмін</Link>
        <div className="grow" /><span className="muted hide-m">{me.user.email}</span>
        <button className="btn btn-ghost" onClick={async () => { await authClient.signOut(); location.href = "/login"; }}>Вийти</button>
      </div>
      <nav className="top-nav">{(["orgs", "devices", "screens", "payments"] as const).map((k) => <button key={k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{{ orgs: "Заклади", devices: "Пристрої", screens: "Екрани", payments: "Платежі" }[k]}</button>)}<Link href="/app" className="tab">Кабінет</Link></nav>
    </header>
    <main className="content">
      {T && <div className="kpis">
        {[["Заклади", T.orgs], ["Користувачі", T.users], ["Пристрої", `${T.devices} · онлайн ${T.online}`], ["Без привʼязки", T.unclaimed], ["Оплачено всього", uah(T.paidTotal)], ["За 30 днів", uah(T.paid30d)]].map(([l, v]) => <div key={String(l)} className="kpi"><span className="muted small">{l}</span><b>{v}</b></div>)}
      </div>}
      {tab === "orgs" && <Card title="Заклади">
        <ErrorBox err={save.err} />
        <table className="tbl"><thead><tr><th>Заклад</th><th>Власник</th><th>Тариф</th><th>До</th><th>Пристрої</th><th>Екрани</th><th>Останні дані</th><th>Оплачено</th><th></th></tr></thead><tbody>
          {ov?.orgs.map((o) => <tr key={o.id}>
            <td data-l="Заклад"><b>{o.name}</b><div className="muted small">{fmtDate(o.createdAt)}</div></td><td data-l="Власник" className="small">{o.owners ?? "—"}</td>
            <td data-l="Тариф">{edit?.id === o.id ? <select value={edit.planId} onChange={(e) => setEdit({ ...edit, planId: e.currentTarget.value })}><option value="free">free</option><option value="pro">pro</option><option value="max">max</option></select> : <b>{o.planId}</b>}</td>
            <td data-l="До" className="small">{edit?.id === o.id ? <input type="date" value={edit.until} onChange={(e) => setEdit({ ...edit, until: e.currentTarget.value })} /> : o.planUntil ? fmtDate(o.planUntil) : (o.planId === "free" ? "—" : "безстроково")}</td>
            <td data-l="Пристрої">{o.devices}{o.devices ? <span className="muted"> · онлайн {o.online}</span> : null}</td><td data-l="Екрани">{o.screens}</td><td data-l="Останні дані" className="small muted">{ago(o.lastSeen)}</td><td data-l="Оплачено">{uah(o.paid)}</td>
            <td className="actions">{edit?.id === o.id ? <><Btn kind="primary" onClick={() => save.run(undefined)} disabled={save.busy}>Зберегти</Btn><Btn kind="ghost" onClick={() => setEdit(null)}>Скасувати</Btn></> : <Btn kind="ghost" onClick={() => setEdit({ id: o.id, planId: o.planId, until: o.planUntil ? o.planUntil.slice(0, 10) : "" })}>Тариф</Btn>}</td>
          </tr>)}
        </tbody></table>
        <p className="muted small">Порожня дата «До» = безстроково. Зміна тарифу скидає нагадування.</p>
      </Card>}
      {tab === "devices" && <Card title="Усі пристрої">
        <table className="tbl small"><thead><tr><th>Пристрій</th><th>Заклад</th><th>Стан</th><th>Інвертор</th><th>Прошивка</th><th>Стік</th></tr></thead><tbody>
          {devs.map((d) => <tr key={d.id}><td data-l="Пристрій"><b>{d.name ?? d.id}</b><div className="muted">{d.id} · {d.hw}</div></td><td data-l="Заклад">{d.orgName ?? <span className="muted">не привʼязаний</span>}</td>
            <td data-l="Стан"><span className={`dot ${d.online ? "on" : "off"}`} /> {d.online ? "онлайн" : "офлайн"}<div className="muted">{ago(d.lastSeenAt)}</div></td><td data-l="Інвертор">{d.modelId ?? "—"}<div className="muted">{d.inverterSerial ?? ""}</div></td><td data-l="Прошивка">{d.fw ?? "—"} <span className="muted">{d.fwChannel}</span></td><td data-l="Стік">{d.stickSerial ?? "—"}</td></tr>)}
        </tbody></table>
      </Card>}
      {tab === "screens" && <Card title={`Екрани · на телевізорах зараз: ${scr.filter((s) => s.viewers > 0).length} з ${scr.length}`}>
        <table className="tbl small"><thead><tr><th>Заклад</th><th>Екран</th><th>Показується</th><th>Телевізор</th><th>Віджетів</th><th>Змінено</th></tr></thead><tbody>
          {scr.map((s) => <tr key={s.id}>
            <td data-l="Заклад"><b>{s.orgName}</b><div className="muted">{s.planId}</div></td>
            <td data-l="Екран">{s.name}<div className="muted">{s.background ? "відео" : "без фону"}{s.radio ? " · радіо" : ""}</div></td>
            <td data-l="Показується">{s.viewers > 0 ? <><span className="dot on" /> так{s.viewers > 1 ? ` · ${s.viewers} ТБ` : ""}</> : <><span className="dot off" /> ні<div className="muted">{s.lastViewedAt ? `востаннє ${ago(s.lastViewedAt)}` : "ще не відкривали"}</div></>}</td>
            <td data-l="Телевізор">{s.tvs.length ? s.tvs.map((tv, i) => <div key={i}>{tv.device} <span className="muted">· з {ago(tv.since)} · {tv.ip}</span></div>) : "—"}</td>
            <td data-l="Віджетів">{s.widgets}</td><td data-l="Змінено" className="muted">{ago(s.updatedAt)}</td>
          </tr>)}
        </tbody></table>
        <p className="muted small">«Показується» = відкритий WebSocket з телевізора; зникає за ~1 хв після закриття сторінки. Оновлюється кожні 30 с.</p>
      </Card>}
      {tab === "payments" && <Card title="Платежі">
        <table className="tbl small"><thead><tr><th>Дата</th><th>Заклад</th><th>Тариф</th><th>Сума</th><th>Статус</th><th>Інвойс</th></tr></thead><tbody>
          {pays.map((p) => <tr key={p.id}><td data-l="Дата">{fmtDate(p.createdAt)}</td><td data-l="Заклад">{p.orgName ?? "—"}</td><td data-l="Тариф">{p.planId} · {p.months} міс.</td><td data-l="Сума">{uah(p.amount)}</td><td data-l="Статус">{STATUS[p.status] ?? p.status}{p.failureReason ? <div className="muted">{p.failureReason}</div> : null}</td><td data-l="Інвойс" className="muted">{p.invoiceId ?? "—"}</td></tr>)}
        </tbody></table>
      </Card>}
    </main>
  </div>;
}
