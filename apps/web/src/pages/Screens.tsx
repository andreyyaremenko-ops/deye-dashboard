import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, screenUrl, type Org, type Screen } from "../api.ts";
import { Btn, Card, ErrorBox, ago, useAction } from "../components/ui.tsx";

export function Screens({ org }: { org: Org }) {
  const [list, setList] = useState<Screen[] | null>(null);
  const canEdit = org.role !== "staff";
  const load = async () => setList(await api.get<Screen[]>(`/api/orgs/${org.id}/screens`));
  useEffect(() => { void load(); const t = setInterval(() => void load().catch(() => {}), 30_000); return () => clearInterval(t); }, [org.id]);
  const create = useAction(async () => { const n = prompt("Назва екрана", "Зал"); if (n) { await api.post(`/api/orgs/${org.id}/screens`, { name: n }); await load(); } });
  const del = useAction(async (s: Screen) => { if (confirm(`Видалити екран «${s.name}»?`)) { await api.del(`/api/orgs/${org.id}/screens/${s.id}`); await load(); } });
  const limit = org.plan.limits.screens;

  return <Card title="Екрани" actions={canEdit && <Btn kind="primary" onClick={() => create.run(undefined)} disabled={(list?.length ?? 0) >= limit}>+ Новий екран</Btn>}>
    <p className="muted small">Тариф {org.plan.name}: до {limit} екран(ів). Посилання відкривайте в браузері телевізора.</p>
    <ErrorBox err={create.err ?? del.err} />
    {list === null ? <p className="muted">Завантаження…</p> : list.length === 0 ? <div className="empty">Ще немає екранів. Створіть перший: «+ Новий екран».</div> :
    <div className="scr-grid">{list.map((s) => {
      const href = `/o/${org.id}/screens/${s.id}`;
      return <article key={s.id} className="scr-card">
        <Link href={href} className={`scr-prev theme-${s.config.theme ?? "dark"}`} title="Редагувати">
          {s.config.widgets.map((w) => <i key={w.id} style={{ left: `${w.x}%`, top: `${w.y}%`, width: `${w.w}%`, height: `${w.h}%` }} />)}
          {s.config.widgets.length === 0 && <span>порожній екран</span>}
        </Link>
        <div className="scr-body">
          <header><Link href={href} className="dev-name">{s.name}</Link>
            {s.viewers ? <span className="pill pill-ok"><span className="dot on" />показується{s.viewers > 1 ? ` · ${s.viewers}` : ""}</span> : <span className="pill pill-off">{s.lastViewedAt ? `востаннє ${ago(s.lastViewedAt)}` : "ще не відкривали"}</span>}
          </header>
          {s.tvs?.map((tv, i) => <div key={i} className="muted small">{tv.device} · {tv.ip} · з {ago(tv.since)}</div>)}
          <div className="muted small">{s.config.widgets.length} віджет(ів){s.config.radioUrl ? " · радіо" : ""} · змінено {ago(s.updatedAt)}</div>
          <footer>
            <a href={screenUrl(s.viewToken)} target="_blank" rel="noreferrer" className="btn btn-sm">Відкрити ↗</a>
            <Link href={href} className="btn btn-sm">Редагувати</Link>
            <span className="grow" />
            {canEdit && <Btn kind="ghost" onClick={() => del.run(s)}>Видалити</Btn>}
          </footer>
        </div>
      </article>;
    })}</div>}
  </Card>;
}
