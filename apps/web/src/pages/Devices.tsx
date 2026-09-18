import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Device, type Org } from "../api.ts";
import { Btn, Card, ErrorBox, Field, ago, onSubmit, useAction } from "../components/ui.tsx";

/** Адреса сервера для стіка: з build-arg VITE_STICK_HOST (напр. IP), інакше домен, на якому відкрито кабінет. */
const STICK_HOST = (import.meta.env.VITE_STICK_HOST as string | undefined) || (typeof location !== "undefined" ? location.hostname : "");
const fmtW = (v: unknown) => (typeof v === "number" ? (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${Math.round(v)} W`) : "—");

export function Devices({ org }: { org: Org }) {
  const [list, setList] = useState<Device[] | null>(null);
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  const canEdit = org.role !== "staff";
  const limit = org.plan.limits.devices;
  const full = (list?.length ?? 0) >= limit;
  const load = async () => setList(await api.get<Device[]>(`/api/orgs/${org.id}/devices`));
  useEffect(() => { void load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [org.id]);

  const claim = useAction(async () => { await api.post(`/api/orgs/${org.id}/devices/claim`, { code, name: name || undefined }); setCode(""); setName(""); await load(); });
  const unclaim = useAction(async (id: string) => { if (confirm("Скинути привʼязку? Пристрій можна буде привʼязати до іншої організації.")) { await api.post(`/api/orgs/${org.id}/devices/${id}/unclaim`); await load(); } });
  const rename = useAction(async (d: Device) => { const n = prompt("Назва пристрою", d.name ?? ""); if (n) { await api.patch(`/api/orgs/${org.id}/devices/${d.id}`, { name: n }); await load(); } });

  return <>
    {canEdit && <Card title="Привʼязати пристрій">
      <form className="row" onSubmit={onSubmit(() => claim.run(undefined))}>
        <Field label="Код з корпусу плати або серійник стіка"><input required value={code} onChange={(e) => setCode(e.currentTarget.value)} placeholder="2QTB-UR3N або 2763543833" style={{ textTransform: "uppercase" }} /></Field>
        <Field label="Назва (необовʼязково)"><input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Інвертор у залі" /></Field>
        <Btn type="submit" kind="primary" disabled={claim.busy || full}>Привʼязати</Btn>
      </form>
      <p className="muted small">Тариф {org.plan.name}: до {limit} логер(ів).{full ? " Ліміт вичерпано — більше логерів у тарифі Pro." : ""}</p>
      <ErrorBox err={claim.err} />
      <details className="hint"><summary>Без плати: підключити Solarman-стік напряму</summary>
        <ol className="small">
          <li>У браузері відкрийте <code>http://&lt;IP стіка&gt;/config_hide.html</code> (логін і пароль зазвичай admin / admin).</li>
          <li>Розділ «Internal server parameters setting»: Protocol <b>TCP-Client</b>, Port <b>10000</b>, Server address <b>{STICK_HOST}</b>, TCP time out <b>300</b>. Save.</li>
          <li>Меню Restart. За хвилину стік зʼявиться тут після привʼязки: код = серійник стіка (10 цифр з наліпки або зі сторінки Status).</li>
        </ol>
        <p className="muted small">Застосунок Solarman продовжує працювати. Локальний порт 8899 у цьому режимі стік не обслуговує.</p>
      </details>
    </Card>}
    <Card title="Пристрої">
      <ErrorBox err={unclaim.err ?? rename.err} />
      {list === null ? <p className="muted">Завантаження…</p> : list.length === 0 ? <div className="empty">Ще немає пристроїв. Введіть код із корпусу плати або серійник стіка вище.</div> :
      <div className="dev-grid">{list.map((d) => {
        const live = d.online && !d.stale;
        return <article key={d.id} className={`dev-card${live ? " is-live" : ""}`}>
          <header>
            <div><Link href={`/o/${org.id}/devices/${d.id}`} className="dev-name">{d.name ?? d.id}</Link><div className="mono muted">{d.id} · {d.hw ?? "?"} {d.fw ?? ""}</div></div>
            <span className={`pill ${live ? "pill-ok" : d.online ? "pill-warn" : "pill-off"}`}><span className={`dot ${live ? "on" : d.online ? "warn" : "off"}`} />{d.online ? (d.stale ? "дані застарілі" : "онлайн") : "офлайн"}</span>
          </header>
          <div className="dev-stats">
            <div><small>Сонце</small><b className="c-amber">{fmtW(d.state?.pv_w)}</b></div>
            <div><small>Батарея</small><b className="c-cyan">{typeof d.state?.bat_soc === "number" ? `${d.state.bat_soc} %` : "—"}</b></div>
            <div><small>Мережа</small><b>{fmtW(d.state?.grid_w)}</b></div>
            <div><small>Споживання</small><b>{fmtW(d.state?.load_w)}</b></div>
          </div>
          <footer>
            <span className="muted small">{d.modelId ?? "модель не визначено"}{d.inverterSerial ? ` · ${d.inverterSerial}` : ""} · {ago(d.stateUpdatedAt ?? d.lastSeenAt)}</span>
            <span className="grow" />
            <Link href={`/o/${org.id}/devices/${d.id}`} className="btn btn-sm">Графіки</Link>
            {canEdit && <Btn kind="ghost" onClick={() => rename.run(d)}>Назва</Btn>}{org.role === "owner" && <Btn kind="ghost" onClick={() => unclaim.run(d.id)}>Відвʼязати</Btn>}
          </footer>
        </article>;
      })}</div>}
    </Card>
  </>;
}
