/** Список меню закладу: створити порожнє або сфотографувати паперове (AI-розпізнавання). */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { api, importMenuPhotos, type MenuSummary, type Org } from "../api.ts";
import { Btn, Card, ErrorBox, ago, useAction } from "../components/ui.tsx";

const STATUS: Record<MenuSummary["status"], [string, string]> = {
  importing: ["pill-warn", "розпізнається"],
  draft: ["pill-off", "чернетка"],
  published: ["pill-ok", "на екранах"],
};

export function Menus({ org }: { org: Org }) {
  const [list, setList] = useState<MenuSummary[] | null>(null);
  const [, navigate] = useLocation();
  const canEdit = org.role !== "staff";
  const load = async () => setList(await api.get<MenuSummary[]>(`/api/orgs/${org.id}/menus`));
  // поки щось розпізнається — оновлюємо список частіше
  useEffect(() => {
    void load();
    const t = setInterval(() => void load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [org.id]);

  const limit = org.plan.limits.menus ?? 1;
  const full = (list?.length ?? 0) >= limit;
  const create = useAction(async () => {
    const n = prompt("Назва меню", "Основне меню");
    if (!n) return;
    const m = await api.post<MenuSummary>(`/api/orgs/${org.id}/menus`, { name: n });
    navigate(`/o/${org.id}/menus/${m.id}`);
  });
  const del = useAction(async (m: MenuSummary) => {
    if (confirm(`Видалити меню «${m.name}» разом із фото страв?`)) { await api.del(`/api/orgs/${org.id}/menus/${m.id}`); await load(); }
  });

  return <>
    <Card title="Меню" actions={canEdit && <>
      <ImportButton org={org} disabled={full} onDone={(menuId) => navigate(`/o/${org.id}/menus/${menuId}`)} />
      <Btn kind="primary" onClick={() => create.run(undefined)} disabled={full}>+ Порожнє меню</Btn>
    </>}>
      <p className="muted small">
        Тариф {org.plan.name}: до {limit} меню. Сфотографуйте паперове меню — система розпізнає позиції й ціни,
        далі ви перевіряєте їх і публікуєте на телевізор.
      </p>
      <ErrorBox err={create.err ?? del.err} />
      {list === null ? <p className="muted">Завантаження…</p>
        : list.length === 0 ? <div className="empty">Ще немає меню. Почніть із фото паперового меню.</div>
        : <table className="tbl"><thead><tr><th>Назва</th><th>Стан</th><th>Позицій</th><th>Змінено</th><th /></tr></thead>
          <tbody>{list.map((m) => {
            const [cls, label] = STATUS[m.status];
            return <tr key={m.id}>
              <td><Link href={`/o/${org.id}/menus/${m.id}`} className="dev-name">{m.name}</Link></td>
              <td><span className={`pill ${cls}`}>{label}</span></td>
              <td>{m.items}</td>
              <td className="muted small">{ago(m.updatedAt)}</td>
              <td className="actions">
                <Link href={`/o/${org.id}/menus/${m.id}`} className="btn btn-sm">{m.status === "draft" ? "Перевірити" : "Редагувати"}</Link>
                {canEdit && <Btn kind="ghost" onClick={() => del.run(m)}>Видалити</Btn>}
              </td>
            </tr>;
          })}</tbody></table>}
    </Card>
    {canEdit && <StyleCard org={org} />}
  </>;
}

/** Вибір 1–5 фото меню + прогрес завантаження. */
function ImportButton({ org, disabled, onDone }: { org: Org; disabled: boolean; onDone: (menuId: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, 5);
    setErr(null); setPct(0);
    try {
      const { menuId } = await importMenuPhotos(org.id, "Меню з фото", list, setPct);
      onDone(menuId);
    } catch (e) { setErr(e); } finally { setPct(null); if (input.current) input.current.value = ""; }
  };
  return <>
    <input ref={input} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => void pick(e.currentTarget.files)} />
    <Btn onClick={() => input.current?.click()} disabled={disabled || pct !== null}>
      {pct === null ? "📷 З фото меню" : `Завантаження ${pct}%`}
    </Btn>
    <ErrorBox err={err} />
  </>;
}

/** Стиль фото страв: один промпт на весь заклад, щоб серія виглядала однаково. */
function StyleCard({ org }: { org: Org }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [bgColor, setBgColor] = useState("#f2ece3");
  const [bgMode, setBgMode] = useState("solid");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api.get<{ prompt: string; bgMode: string; bgColor: string | null }>(`/api/orgs/${org.id}/menu-style`).then((s) => {
      setPrompt(s.prompt); setBgMode(s.bgMode); setBgColor(s.bgColor ?? "#f2ece3");
    });
  }, [org.id]);
  const save = useAction(async () => {
    await api.put(`/api/orgs/${org.id}/menu-style`, { prompt, bgMode, bgColor: bgMode === "solid" ? bgColor : null });
    setSaved(true); setTimeout(() => setSaved(false), 2500);
  });
  if (prompt === null) return null;

  return <Card title="Стиль фото страв">
    <p className="muted small">Цей опис додається до кожного фото: світло, подача, настрій. Назви страв і «без тексту» додаються автоматично.</p>
    <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} />
    <div className="row small" style={{ marginTop: ".6rem" }}>
      <label className="field"><span>Тло</span>
        <select value={bgMode} onChange={(e) => setBgMode(e.currentTarget.value)}>
          <option value="solid">однотонне кольорове</option>
          <option value="transparent">світле нейтральне</option>
        </select>
      </label>
      {bgMode === "solid" && <label className="field"><span>Колір тла</span>
        <input type="color" value={bgColor} onChange={(e) => setBgColor(e.currentTarget.value)} />
      </label>}
      <span className="grow" />
      <Btn onClick={() => save.run(undefined)} disabled={save.busy || (prompt?.trim().length ?? 0) < 10}>Зберегти стиль</Btn>
    </div>
    {saved && <div className="ok">Стиль збережено. Нові фото генеруватимуться в ньому.</div>}
    <ErrorBox err={save.err} />
  </Card>;
}
