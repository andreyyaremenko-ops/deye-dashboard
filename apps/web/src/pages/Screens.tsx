import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, screenUrl, type Org, type Screen } from "../api.ts";
import { Btn, Card, ErrorBox, ago, useAction } from "../components/ui.tsx";

export function Screens({ org }: { org: Org }) {
  const [list, setList] = useState<Screen[] | null>(null);
  const canEdit = org.role !== "staff";
  const load = async () => setList(await api.get<Screen[]>(`/api/orgs/${org.id}/screens`));
  useEffect(() => { void load(); }, [org.id]);
  const create = useAction(async () => { const n = prompt("Назва екрана", "Зал"); if (n) { await api.post(`/api/orgs/${org.id}/screens`, { name: n }); await load(); } });
  const del = useAction(async (s: Screen) => { if (confirm(`Видалити екран «${s.name}»?`)) { await api.del(`/api/orgs/${org.id}/screens/${s.id}`); await load(); } });
  const limit = org.plan.limits.screens;

  return <Card title="Екрани" actions={canEdit && <Btn kind="primary" onClick={() => create.run(undefined)} disabled={(list?.length ?? 0) >= limit}>+ Новий екран</Btn>}>
    <p className="muted small">Тариф {org.plan.name}: до {limit} екран(ів). Посилання відкривайте в браузері телевізора.</p>
    <ErrorBox err={create.err ?? del.err} />
    {list === null ? <p className="muted">Завантаження…</p> : list.length === 0 ? <p className="muted">Ще немає екранів.</p> :
    <table className="tbl"><thead><tr><th>Назва</th><th>Віджетів</th><th>Радіо</th><th>Змінено</th><th>Посилання для ТБ</th><th></th></tr></thead>
      <tbody>{list.map((s) => <tr key={s.id}>
        <td data-l="Назва"><Link href={`/o/${org.id}/screens/${s.id}`}><b>{s.name}</b></Link></td>
        <td data-l="Віджетів">{s.config.widgets.length}</td>
        <td data-l="Радіо">{s.config.radioUrl ? "так" : "—"}</td>
        <td data-l="Змінено" className="muted small">{ago(s.updatedAt)}</td>
        <td data-l="Посилання"><a href={screenUrl(s.viewToken)} target="_blank" rel="noreferrer" className="small">{screenUrl(s.viewToken).replace(/^https?:\/\//, "").slice(0, 34)}…</a></td>
        <td className="actions"><Link href={`/o/${org.id}/screens/${s.id}`} className="btn btn-ghost">Редагувати</Link>{canEdit && <Btn kind="ghost" onClick={() => del.run(s)}>Видалити</Btn>}</td>
      </tr>)}</tbody></table>}
  </Card>;
}
