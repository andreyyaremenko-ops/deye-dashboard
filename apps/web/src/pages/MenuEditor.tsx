/**
 * Екран перевірки й редагування меню: позиції з фото меню приходять з оцінкою впевненості,
 * усе нижче 0.9 підсвічено — власник виправляє ціни й назви і публікує меню на телевізор.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { CONFIDENCE_OK, formatPrice } from "@deye/shared";
import {
  api, mediaUrl, uploadDishPhoto, type AiUsage, type DishImage, type DishImages,
  type ImportState, type MenuItem, type MenuTree, type Org,
} from "../api.ts";
import { Btn, Card, ErrorBox, useAction } from "../components/ui.tsx";

export function MenuEditor({ org, menuId }: { org: Org; menuId: string }) {
  const [menu, setMenu] = useState<MenuTree | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [imp, setImp] = useState<ImportState | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const canEdit = org.role !== "staff";
  const base = `/api/orgs/${org.id}/menus/${menuId}`;

  const load = useCallback(async () => {
    setMenu(await api.get<MenuTree>(base));
    if (canEdit) setUsage(await api.get<AiUsage>(`/api/orgs/${org.id}/ai-usage`).catch(() => null));
  }, [base, org.id, canEdit]);
  useEffect(() => { void load().catch(setErr); }, [load]);

  // поки триває розпізнавання — опитуємо стан задачі
  useEffect(() => {
    if (menu?.status !== "importing") return;
    const t = setInterval(async () => {
      const st = await api.get<ImportState>(`${base}/import`).catch(() => null);
      if (!st) return;
      setImp(st);
      if (st.menu.status !== "importing") { clearInterval(t); void load(); }
    }, 3000);
    return () => clearInterval(t);
  }, [menu?.status, base, load]);

  const publish = useAction(async () => { await api.post(`${base}/publish`); await load(); });
  const addSection = useAction(async () => {
    const name = prompt("Назва розділу", "Новий розділ");
    if (name) { await api.post(`${base}/sections`, { name }); await load(); }
  });
  const generateAll = useAction(async () => {
    const r = await api.post<{ queued: number; items: number; stopped: string | null }>(`${base}/images`, {});
    await load();
    if (r.stopped) alert(`Поставлено в чергу ${r.queued} з ${r.items}. Далі не вистачає ліміту тарифу.`);
  });

  if (err) return <Card title="Меню"><ErrorBox err={err} /><Link href={`/o/${org.id}/menus`} className="btn btn-sm">← До списку</Link></Card>;
  if (!menu) return <Card title="Меню"><p className="muted">Завантаження…</p></Card>;

  const items = menu.sections.flatMap((s) => s.items);
  const toCheck = items.filter((i) => i.confidence !== null && i.confidence < CONFIDENCE_OK).length;
  const noPhoto = items.filter((i) => !i.imageId).length;

  return <>
    <Card title={menu.name} actions={<>
      <Link href={`/o/${org.id}/menus`} className="btn btn-sm">← До списку</Link>
      {canEdit && menu.status !== "published" && <Btn kind="primary" onClick={() => publish.run(undefined)} disabled={!items.length || menu.status === "importing"}>Підтвердити меню</Btn>}
    </>}>
      <ErrorBox err={publish.err ?? addSection.err ?? generateAll.err} />
      {menu.status === "importing" && <div className="ok">
        <span className="spin" /> Розпізнаємо фото меню… Це займає до хвилини, сторінка оновиться сама.
        {imp?.job?.status === "failed" && <b>Не вдалося: {imp.job.error}</b>}
      </div>}
      {menu.status === "draft" && !!items.length && <p className="muted small">
        Чернетка: {items.length} позиц. {toCheck > 0 && <b className="c-amber">{toCheck} потребує перевірки (підсвічено)</b>} · на телевізорі меню зʼявиться після «Підтвердити меню».
      </p>}
      {menu.status === "published" && <p className="muted small">Меню опубліковане: зміни цін і наявності зʼявляються на телевізорах одразу.</p>}

      {usage && canEdit && <div className="ai-bar">
        <span>Фото страв цього місяця: <b>{usage.imagesMonth}</b> з {usage.limits.aiGenerationsMonth}</span>
        <span>Страв із AI-фото: <b>{usage.dishesWithAi}</b> з {usage.limits.aiDishes}</span>
        <span className="muted">витрачено ${(usage.costMicros / 1_000_000).toFixed(2)}</span>
        <span className="grow" />
        {noPhoto > 0 && <Btn onClick={() => generateAll.run(undefined)} disabled={generateAll.busy || usage.remaining.images < 1}>
          Згенерувати фото ({noPhoto} без фото)
        </Btn>}
      </div>}
    </Card>

    {menu.sections.map((s) => <SectionCard key={s.id} org={org} menu={menu} section={s} canEdit={canEdit} onChanged={load} />)}
    {canEdit && <div><Btn onClick={() => addSection.run(undefined)}>+ Розділ</Btn></div>}
  </>;
}

function SectionCard({ org, menu, section, canEdit, onChanged }: {
  org: Org; menu: MenuTree; section: MenuTree["sections"][number]; canEdit: boolean; onChanged: () => Promise<void>;
}) {
  const base = `/api/orgs/${org.id}/menus/${menu.id}`;
  const rename = useAction(async () => {
    const name = prompt("Назва розділу", section.name);
    if (name && name !== section.name) { await api.patch(`${base}/sections/${section.id}`, { name }); await onChanged(); }
  });
  const del = useAction(async () => {
    if (confirm(`Видалити розділ «${section.name}» з усіма позиціями?`)) { await api.del(`${base}/sections/${section.id}`); await onChanged(); }
  });
  const add = useAction(async () => {
    await api.post(`${base}/items`, { sectionId: section.id, name: "Нова позиція", price: null });
    await onChanged();
  });

  return <Card title={section.name} actions={canEdit && <>
    <Btn kind="ghost" onClick={() => rename.run(undefined)}>Перейменувати</Btn>
    <Btn kind="ghost" onClick={() => del.run(undefined)}>Видалити</Btn>
    <Btn onClick={() => add.run(undefined)}>+ Позиція</Btn>
  </>}>
    <ErrorBox err={rename.err ?? del.err ?? add.err} />
    {section.items.length === 0 ? <div className="empty">Порожній розділ</div>
      : <div className="mi-list">{section.items.map((i) =>
        <ItemRow key={i.id} org={org} menu={menu} item={i} canEdit={canEdit} onChanged={onChanged} />)}</div>}
  </Card>;
}

function ItemRow({ org, menu, item, canEdit, onChanged }: { org: Org; menu: MenuTree; item: MenuItem; canEdit: boolean; onChanged: () => Promise<void> }) {
  const base = `/api/orgs/${org.id}/menus/${menu.id}`;
  const [d, setD] = useState({ name: item.name, description: item.description ?? "", price: formatPrice(item.price), volume: item.volume ?? "" });
  const [photos, setPhotos] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    setD({ name: item.name, description: item.description ?? "", price: formatPrice(item.price), volume: item.volume ?? "" });
  }, [item.id, item.name, item.description, item.price, item.volume]);

  const unsure = item.confidence !== null && item.confidence < CONFIDENCE_OK;
  const save = async (patch: Record<string, unknown>) => {
    setErr(null);
    try { await api.patch(`${base}/items/${item.id}`, patch); await onChanged(); } catch (e) { setErr(e); }
  };
  // зберігаємо на blur, тільки якщо значення справді змінилось
  const blur = (field: "name" | "description" | "price" | "volume") => () => {
    const value = d[field].trim();
    const was = (field === "price" ? formatPrice(item.price) : item[field] ?? "").trim();
    if (value === was) return;
    void save({ [field]: field === "name" ? value : value || null });
  };
  const del = async () => {
    if (!confirm(`Видалити «${item.name}»?`)) return;
    setErr(null);
    try { await api.del(`${base}/items/${item.id}`); await onChanged(); } catch (e) { setErr(e); }
  };
  // наявність може міняти й персонал — це щоденна робота залу
  const toggleStock = async () => {
    setErr(null);
    try { await api.patch(`${base}/items/${item.id}/stock`, { inStock: !item.inStock }); await onChanged(); } catch (e) { setErr(e); }
  };

  return <div className={`mi${unsure ? " unsure" : ""}${item.inStock ? "" : " out"}`}>
    <button className="mi-photo" onClick={() => setPhotos((v) => !v)} title="Фото страви" disabled={!canEdit}>
      {item.imageId ? <img src={mediaUrl(photoOf(item))} alt="" /> : <span>фото</span>}
    </button>
    <div className="mi-main">
      <input className="mi-name" value={d.name} disabled={!canEdit} onChange={(e) => setD({ ...d, name: e.currentTarget.value })} onBlur={blur("name")} />
      <input className="mi-desc" placeholder="опис (необовʼязково)" value={d.description} disabled={!canEdit}
        onChange={(e) => setD({ ...d, description: e.currentTarget.value })} onBlur={blur("description")} />
    </div>
    <input className="mi-vol" placeholder="250 мл" value={d.volume} disabled={!canEdit}
      onChange={(e) => setD({ ...d, volume: e.currentTarget.value })} onBlur={blur("volume")} />
    <input className="mi-price" placeholder="—" value={d.price} disabled={!canEdit}
      onChange={(e) => setD({ ...d, price: e.currentTarget.value })} onBlur={blur("price")} />
    <select className="mi-sec" value={item.sectionId} disabled={!canEdit} onChange={(e) => void save({ sectionId: e.currentTarget.value })}>
      {menu.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
    <label className="mi-stock" title="Є в наявності">
      <input type="checkbox" checked={item.inStock} onChange={toggleStock} /> є
    </label>
    {canEdit && <Btn kind="ghost" onClick={() => void del()}>✕</Btn>}
    {unsure && <span className="mi-flag" title={`Впевненість розпізнавання ${Math.round((item.confidence ?? 0) * 100)}%`}>перевірте</span>}
    <ErrorBox err={err} />
    {photos && canEdit && <PhotoPanel org={org} menuId={menu.id} item={item} onChanged={onChanged} />}
  </div>;
}

const photoOf = (item: MenuItem) => {
  const chosen = item.images?.find((i) => i.id === item.imageId);
  return chosen?.thumb ?? chosen?.file ?? "";
};

/** Варіанти фото страви: згенерувати, обрати, перегенерувати, завантажити власне. */
function PhotoPanel({ org, menuId, item, onChanged }: { org: Org; menuId: string; item: MenuItem; onChanged: () => Promise<void> }) {
  const base = `/api/orgs/${org.id}/menus/${menuId}/items/${item.id}/images`;
  const [state, setState] = useState<DishImages | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => setState(await api.get<DishImages>(base)), [base]);
  useEffect(() => { void load().catch(setErr); }, [load]);
  // поки воркер малює — оновлюємо панель
  useEffect(() => {
    const st = state?.job?.status;
    if (st !== "queued" && st !== "running") return;
    const t = setInterval(() => void load().then(() => onChanged()).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [state?.job?.status, load, onChanged]);

  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); await load(); await onChanged(); } catch (e) { setErr(e); } };
  const busy = state?.job?.status === "queued" || state?.job?.status === "running";

  return <div className="mi-photos">
    <div className="mi-photos-h">
      <Btn kind="ghost" onClick={() => void run(() => api.post(base, { n: 3 }))} disabled={busy}>
        {state?.images.length ? "Перегенерувати" : "Згенерувати фото"}
      </Btn>
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden
        onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void run(() => uploadDishPhoto(org.id, menuId, item.id, f)); e.currentTarget.value = ""; }} />
      <Btn kind="ghost" onClick={() => file.current?.click()} disabled={busy}>Своє фото…</Btn>
      {busy && <span className="muted small"><span className="spin" /> малюємо варіанти…</span>}
      {state?.job?.status === "failed" && <span className="c-amber small">Не вдалося: {state.job.error}</span>}
    </div>
    <ErrorBox err={err} />
    {!!state?.images.length && <div className="mi-variants">{state.images.map((img) =>
      <Variant key={img.id} img={img} chosen={img.id === state.chosen}
        onChoose={() => void run(() => api.post(`${base}/${img.id}/choose`))}
        onDelete={() => void run(() => api.del(`${base}/${img.id}`))} />)}</div>}
  </div>;
}

function Variant({ img, chosen, onChoose, onDelete }: { img: DishImage; chosen: boolean; onChoose: () => void; onDelete: () => void }) {
  return <figure className={`mi-var${chosen ? " on" : ""}`}>
    <img src={mediaUrl(img.thumb ?? img.file ?? "")} alt="" onClick={onChoose} />
    <figcaption>
      {chosen ? <b>обране</b> : <button className="btn btn-xs" onClick={onChoose}>обрати</button>}
      {!img.isAi && <span className="pill pill-off">своє</span>}
      <button className="btn btn-xs" onClick={onDelete} title="Видалити варіант">✕</button>
    </figcaption>
  </figure>;
}
