import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, type Device, type Org } from "../api.ts";
import { Btn, Card, ErrorBox, Field, ago, onSubmit, useAction } from "../components/ui.tsx";

const fmtW = (v: unknown) => (typeof v === "number" ? (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${Math.round(v)} W`) : "—");

export function Devices({ org }: { org: Org }) {
  const [list, setList] = useState<Device[] | null>(null);
  const [code, setCode] = useState(""); const [name, setName] = useState("");
  const canEdit = org.role !== "staff";
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
        <Btn type="submit" kind="primary" disabled={claim.busy}>Привʼязати</Btn>
      </form>
      <ErrorBox err={claim.err} />
      <details className="hint"><summary>Без плати: підключити Solarman-стік напряму</summary>
        <ol className="small">
          <li>У браузері відкрийте <code>http://&lt;IP стіка&gt;/config_hide.html</code> (логін і пароль зазвичай admin / admin).</li>
          <li>Розділ «Internal server parameters setting»: Protocol <b>TCP-Client</b>, Port <b>10000</b>, Server address <b>193.242.161.21</b>, TCP time out <b>300</b>. Save.</li>
          <li>Меню Restart. За хвилину стік зʼявиться тут після привʼязки: код = серійник стіка (10 цифр з наліпки або зі сторінки Status).</li>
        </ol>
        <p className="muted small">Застосунок Solarman продовжує працювати. Локальний порт 8899 у цьому режимі стік не обслуговує.</p>
      </details>
    </Card>}
    <Card title="Пристрої">
      <ErrorBox err={unclaim.err ?? rename.err} />
      {list === null ? <p className="muted">Завантаження…</p> : list.length === 0 ? <p className="muted">Ще немає пристроїв. Введіть код із корпусу вище.</p> :
      <table className="tbl"><thead><tr><th>Назва</th><th>Стан</th><th>Сонце</th><th>Батарея</th><th>Мережа</th><th>Споживання</th><th>Інвертор</th><th></th></tr></thead>
        <tbody>{list.map((d) => <tr key={d.id}>
          <td><Link href={`/o/${org.id}/devices/${d.id}`}><b>{d.name ?? d.id}</b></Link><div className="muted small">{d.id} · {d.hw ?? "?"} {d.fw ?? ""}</div></td>
          <td><span className={`dot ${d.online && !d.stale ? "on" : d.online ? "warn" : "off"}`} /> {d.online ? (d.stale ? "дані застарілі" : "онлайн") : "офлайн"}<div className="muted small">{ago(d.stateUpdatedAt ?? d.lastSeenAt)}</div></td>
          <td>{fmtW(d.state?.pv_w)}</td>
          <td>{typeof d.state?.bat_soc === "number" ? `${d.state.bat_soc}%` : "—"}</td>
          <td>{fmtW(d.state?.grid_w)}</td>
          <td>{fmtW(d.state?.load_w)}</td>
          <td className="small">{d.modelId ?? "не визначено"}<div className="muted">{d.inverterSerial ?? ""}</div></td>
          <td className="actions">{canEdit && <Btn kind="ghost" onClick={() => rename.run(d)}>Назва</Btn>}{org.role === "owner" && <Btn kind="ghost" onClick={() => unclaim.run(d.id)}>Відвʼязати</Btn>}</td>
        </tr>)}</tbody></table>}
    </Card>
  </>;
}
