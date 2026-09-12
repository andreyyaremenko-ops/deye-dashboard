import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { screenConfigSchema, type ScreenConfig } from "@deye/shared";
import { api, screenUrl, type Device, type Org, type RadioStation, type Screen } from "../api.ts";
import { Btn, Card, ErrorBox, Field, useAction } from "../components/ui.tsx";
import { Canvas } from "../editor/Canvas.tsx";
import { BackgroundPicker } from "../editor/BackgroundPicker.tsx";

type W = ScreenConfig["widgets"][number];
const TYPES: { t: W["type"]; label: string; needsDevice: boolean; w: number; h: number }[] = [
  { t: "pv", label: "Сонце", needsDevice: true, w: 22, h: 18 },
  { t: "battery", label: "Батарея", needsDevice: true, w: 22, h: 20 },
  { t: "grid", label: "Мережа", needsDevice: true, w: 22, h: 18 },
  { t: "load", label: "Споживання", needsDevice: true, w: 22, h: 18 },
  { t: "energy_today", label: "Підсумок дня", needsDevice: true, w: 22, h: 26 },
  { t: "runtime", label: "Автономія", needsDevice: true, w: 22, h: 18 },
  { t: "chart", label: "Графік доби", needsDevice: true, w: 44, h: 30 },
  { t: "qr", label: "QR-код", needsDevice: false, w: 14, h: 30 },
  { t: "clock", label: "Годинник", needsDevice: false, w: 22, h: 16 },
  { t: "text", label: "Меню / текст", needsDevice: false, w: 28, h: 50 },
];

export function ScreenEditor({ org, screenId }: { org: Org; screenId: string }) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [cfg, setCfg] = useState<ScreenConfig | null>(null);
  const [name, setName] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [radio, setRadio] = useState<RadioStation[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const canEdit = org.role !== "staff";

  useEffect(() => {
    void (async () => {
      const [list, devs, st] = await Promise.all([api.get<Screen[]>(`/api/orgs/${org.id}/screens`), api.get<Device[]>(`/api/orgs/${org.id}/devices`), api.get<RadioStation[]>("/api/radio")]);
      const s = list.find((x) => x.id === screenId) ?? null;
      setScreen(s); setCfg(s ? screenConfigSchema.parse(s.config) : null); setName(s?.name ?? ""); setDevices(devs); setRadio(st);
    })();
  }, [org.id, screenId]);

  const update = (patch: Partial<ScreenConfig>) => { setCfg((c) => (c ? { ...c, ...patch } : c)); setDirty(true); };
  const updateWidget = (w: W) => update({ widgets: cfg!.widgets.map((x) => (x.id === w.id ? w : x)) });
  const addWidget = (t: typeof TYPES[number]) => {
    const id = `${t.t}-${Math.random().toString(36).slice(2, 7)}`;
    const dev = devices[0]?.id;
    const n = cfg!.widgets.length;
    update({ widgets: [...cfg!.widgets, { id, type: t.t, x: 3 + (n % 3) * 25, y: 4 + Math.floor(n / 3) * 24, w: t.w, h: t.h, deviceId: t.needsDevice ? dev : undefined, props: t.t === "qr" ? { url: "https://instagram.com/", caption: "Ми в Instagram", card: true } : t.t === "text" ? { title: "Меню", text: "Еспресо — 45\nКапучино — 65\nЛате — 70\n# Десерти\nЧізкейк — 95", size: "medium", align: "left", card: true } : {} }] });
    setSel(id);
  };
  const removeWidget = (id: string) => { update({ widgets: cfg!.widgets.filter((w) => w.id !== id) }); setSel(null); };

  const save = useAction(async () => {
    const s = await api.patch<Screen>(`/api/orgs/${org.id}/screens/${screenId}`, { name, config: cfg });
    setScreen(s); setCfg(screenConfigSchema.parse(s.config)); setDirty(false);
  });
  const rotate = useAction(async () => {
    if (!confirm("Перевипустити посилання? Старе перестане працювати на всіх телевізорах.")) return;
    setScreen(await api.post<Screen>(`/api/orgs/${org.id}/screens/${screenId}/rotate-token`));
  });
  const selected = useMemo(() => cfg?.widgets.find((w) => w.id === sel) ?? null, [cfg, sel]);
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!pair) return;
    const tick = () => setLeft(Math.max(0, Math.round((Date.parse(pair.expiresAt) - Date.now()) / 1000)));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [pair]);
  const issue = useAction(async () => { setPair(await api.post(`/api/orgs/${org.id}/screens/${screenId}/pair-code`)); });

  if (!screen || !cfg) return <p className="muted">Завантаження…</p>;
  const url = screenUrl(screen.viewToken);
  const radioAllowed = org.plan.limits.radio;

  return <div className="editor">
    <div className="editor-top">
      <Link href={`/o/${org.id}/screens`} className="btn btn-ghost">← Екрани</Link>
      <input className="name" value={name} onChange={(e) => { setName(e.currentTarget.value); setDirty(true); }} disabled={!canEdit} />
      <div className="grow" />
      <a href={url} target="_blank" rel="noreferrer" className="btn">Відкрити на ТБ ↗</a>
      <Btn onClick={() => navigator.clipboard?.writeText(url)}>Копіювати посилання</Btn>
      {canEdit && <Btn kind="ghost" onClick={() => rotate.run(undefined)} title="Перевипустити посилання">Перевипустити</Btn>}
      {canEdit && <Btn kind="primary" onClick={() => save.run(undefined)} disabled={!dirty || save.busy}>{save.busy ? "Зберігаю…" : dirty ? "Зберегти" : "Збережено"}</Btn>}
    </div>
    <ErrorBox err={save.err ?? rotate.err} />
    <div className="editor-body">
      <Canvas widgets={cfg.widgets} selected={sel} onSelect={setSel} onChange={updateWidget} theme={cfg.theme} />
      <aside className="side">
        <Card title="Додати віджет">
          <div className="chips">{TYPES.map((t) => <button key={t.t} className="chip" disabled={!canEdit || (t.needsDevice && devices.length === 0)} onClick={() => addWidget(t)}>{t.label}</button>)}</div>
          {devices.length === 0 && <p className="muted small">Спершу привʼяжіть пристрій.</p>}
        </Card>
        {selected && <Card title={`Віджет: ${TYPES.find((t) => t.t === selected.type)?.label ?? selected.type}`}
          actions={canEdit && <Btn kind="danger" onClick={() => removeWidget(selected.id)}>Видалити</Btn>}>
          {TYPES.find((t) => t.t === selected.type)?.needsDevice && <Field label="Пристрій">
            <select value={selected.deviceId ?? ""} onChange={(e) => updateWidget({ ...selected, deviceId: e.currentTarget.value })}>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name ?? d.id}</option>)}
            </select></Field>}
          {selected.type === "qr" && <>
            <Field label="Посилання (URL, WIFI:T:WPA;S:назва;P:пароль;; тощо)"><input value={String(selected.props?.url ?? "")} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, url: e.currentTarget.value } })} /></Field>
            <Field label="Підпис"><input value={String(selected.props?.caption ?? "")} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, caption: e.currentTarget.value } })} /></Field>
            <Field label="Картка"><select value={selected.props?.card === false ? "0" : "1"} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, card: e.currentTarget.value === "1" } })}><option value="1">з фоном</option><option value="0">без фону</option></select></Field>
          </>}
          {selected.type === "chart" && <Field label="Період"><select value={String(selected.props?.hours ?? 24)} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, hours: Number(e.currentTarget.value) } })}><option value="24">24 години</option><option value="72">3 доби</option><option value="168">тиждень</option></select></Field>}
          {selected.type === "text" && <>
            <Field label="Заголовок"><input value={String(selected.props?.title ?? "")} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, title: e.currentTarget.value } })} placeholder="Меню" /></Field>
            <Field label="Рядки (назва — ціна; рядок з # це підзаголовок)">
              <textarea rows={10} value={String(selected.props?.text ?? "")} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, text: e.currentTarget.value } })} />
            </Field>
            <div className="row small">
              <Field label="Розмір"><select value={String(selected.props?.size ?? "medium")} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, size: e.currentTarget.value } })}><option value="small">малий</option><option value="medium">середній</option><option value="large">великий</option></select></Field>
              <Field label="Вирівнювання"><select value={String(selected.props?.align ?? "left")} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, align: e.currentTarget.value } })}><option value="left">ліворуч</option><option value="center">по центру</option></select></Field>
              <Field label="Картка"><select value={selected.props?.card === false ? "0" : "1"} onChange={(e) => updateWidget({ ...selected, props: { ...selected.props, card: e.currentTarget.value === "1" } })}><option value="1">з фоном</option><option value="0">без фону</option></select></Field>
            </div>
          </>}
          <div className="row small">
            <Field label="X %"><input type="number" value={selected.x} onChange={(e) => updateWidget({ ...selected, x: +e.currentTarget.value })} /></Field>
            <Field label="Y %"><input type="number" value={selected.y} onChange={(e) => updateWidget({ ...selected, y: +e.currentTarget.value })} /></Field>
            <Field label="Ш %"><input type="number" value={selected.w} onChange={(e) => updateWidget({ ...selected, w: +e.currentTarget.value })} /></Field>
            <Field label="В %"><input type="number" value={selected.h} onChange={(e) => updateWidget({ ...selected, h: +e.currentTarget.value })} /></Field>
          </div>
        </Card>}
        <Card title="Екран">
          <Field label="Тема"><select value={cfg.theme} onChange={(e) => update({ theme: e.currentTarget.value as "dark" | "light" })} disabled={!canEdit}><option value="dark">Темна</option><option value="light">Світла</option></select></Field>
          <div className="field"><span>Фон</span><BackgroundPicker org={org} value={cfg.backgroundId} onChange={(id) => update({ backgroundId: id })} canEdit={canEdit} /></div>
          <Field label={`Радіо${radioAllowed ? "" : " (недоступно в тарифі)"}`}>
            <select value={cfg.radioUrl ?? ""} disabled={!canEdit || !radioAllowed} onChange={(e) => update({ radioUrl: e.currentTarget.value || null })}>
              <option value="">Вимкнено</option>
              {radio.map((r) => <option key={r.id} value={r.url}>{r.title}</option>)}
            </select></Field>
          {cfg.radioUrl && <Field label={`Гучність ${Math.round(cfg.radioVolume * 100)}%`}><input type="range" min={0} max={1} step={0.05} value={cfg.radioVolume} onChange={(e) => update({ radioVolume: +e.currentTarget.value })} disabled={!canEdit} /></Field>}
        </Card>
        <Card title="Підключити телевізор">
          <p className="small">На телевізорі відкрийте <b>tv.sun-hunter.men/tv</b> і введіть код:</p>
          {pair && left > 0
            ? <div className="paircode"><b>{pair.code.slice(0, 3)} {pair.code.slice(3)}</b><span className="muted small">діє ще {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span></div>
            : <Btn kind="primary" onClick={() => issue.run(undefined)} disabled={!canEdit || issue.busy}>Код для ТБ</Btn>}
          <ErrorBox err={issue.err} />
          <p className="muted small">Після введення ТБ запамʼятає екран. Повне посилання, якщо зручніше:</p>
          <code className="small wrap">{url}</code>
          <p className="muted small">Лише перегляд. Не дає доступу до кабінету.</p>
        </Card>
      </aside>
    </div>
  </div>;
}
