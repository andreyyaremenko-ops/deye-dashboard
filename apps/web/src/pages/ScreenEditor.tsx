/** Редактор екрана: пульт (радіо, фон, сповіщення), полотно з віджетами, вкладки «Віджети · Сцена · Екран». */
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "wouter";
import { screenConfigSchema, type Scene, type ScreenConfig } from "@deye/shared";
import { api, screenUrl, type Device, type MenuSummary, type NvrCamera, type Org, type OrgRadio, type Screen } from "../api.ts";
import { Btn, Card, ErrorBox, useAction } from "../components/ui.tsx";
import { Canvas } from "../editor/Canvas.tsx";
import { WidgetSettings } from "../editor/WidgetSettings.tsx";
import { ScreenSettings } from "../editor/ScreenSettings.tsx";
import { SceneSettings } from "../editor/SceneSettings.tsx";
import { SceneTabs, sceneTitle } from "../editor/SceneTabs.tsx";
import { ScreenControls } from "../editor/ScreenControls.tsx";
import { BackgroundDialog } from "../editor/BackgroundDialog.tsx";
import { bgPreview, useBackgrounds } from "../editor/useBackgrounds.ts";
import { PairCard } from "../editor/PairCard.tsx";
import { WIDGET_KINDS, labelOf, newWidget, type Widget, type WidgetKind } from "../editor/widgetTypes.ts";

type Tab = "widgets" | "scene" | "screen";
const TABS: [Tab, string][] = [["widgets", "Віджети"], ["scene", "Сцена"], ["screen", "Екран"]];
const LEAVE = "Є незбережені зміни. Піти без збереження?";

export function ScreenEditor({ org, screenId }: { org: Org; screenId: string }) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [cfg, setCfg] = useState<ScreenConfig | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<{ name: string; cfg: ScreenConfig } | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [cameras, setCameras] = useState<NvrCamera[]>([]);
  const [radio, setRadio] = useState<OrgRadio>({ catalog: [], own: [] });
  const reloadRadio = async () => setRadio(await api.get<OrgRadio>(`/api/orgs/${org.id}/radio`));
  const bgs = useBackgrounds(org.id);
  const [sel, setSel] = useState<string | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [tab, setTab] = useState<Tab>("widgets");
  const [bgOpen, setBgOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const canEdit = org.role !== "staff";

  useEffect(() => {
    void (async () => {
      const [list, devs, st, mns, cams] = await Promise.all([api.get<Screen[]>(`/api/orgs/${org.id}/screens`), api.get<Device[]>(`/api/orgs/${org.id}/devices`), api.get<OrgRadio>(`/api/orgs/${org.id}/radio`), api.get<MenuSummary[]>(`/api/orgs/${org.id}/menus`).catch(() => []),
        api.get<{ cameras: NvrCamera[] }>(`/api/orgs/${org.id}/nvr/cameras`).then((r) => r.cameras).catch(() => [])]);
      const s = list.find((x) => x.id === screenId) ?? null;
      const c = s ? screenConfigSchema.parse(s.config) : null;
      setScreen(s); setCfg(c); setName(s?.name ?? ""); setSaved(s && c ? { name: s.name, cfg: c } : null); setDevices(devs); setRadio(st); setMenus(mns); setCameras(cams);
    })();
  }, [org.id, screenId]);

  const update = (patch: Partial<ScreenConfig>) => { setCfg((c) => (c ? { ...c, ...patch } : c)); setDirty(true); };
  // усе, що стосується віджетів, фону й теми, редагується в межах активної сцени
  const scene: Scene | null = cfg ? cfg.scenes[Math.min(sceneIdx, cfg.scenes.length - 1)] ?? null : null;
  const updateScene = (patch: Partial<Scene>) => update({ scenes: cfg!.scenes.map((sc) => (sc.id === scene!.id ? { ...sc, ...patch } : sc)) });
  const updateWidget = (w: Widget) => updateScene({ widgets: scene!.widgets.map((x) => (x.id === w.id ? w : x)) });
  const addWidget = (kind: WidgetKind) => {
    const w = newWidget(kind, scene!.widgets.length, devices[0]?.id);
    updateScene({ widgets: [...scene!.widgets, w] });
    setSel(w.id);
  };
  const removeWidget = (id: string) => { updateScene({ widgets: scene!.widgets.filter((w) => w.id !== id) }); setSel(null); };
  const selectScene = (i: number) => { setSceneIdx(i); setSel(null); };
  const selectWidget = (id: string | null) => { setSel(id); if (id) setTab("widgets"); };
  const pickBackground = (id: string | null, all: boolean) =>
    all ? update({ scenes: cfg!.scenes.map((sc) => ({ ...sc, backgroundId: id })) }) : updateScene({ backgroundId: id });

  const save = useAction(async () => {
    const s = await api.patch<Screen>(`/api/orgs/${org.id}/screens/${screenId}`, { name, config: cfg });
    const c = screenConfigSchema.parse(s.config);
    setScreen(s); setCfg(c); setSaved({ name: s.name, cfg: c }); setDirty(false);
  });
  const discard = () => { if (!saved) return; setCfg(saved.cfg); setName(saved.name); setSel(null); setDirty(false); };
  const rotate = useAction(async () => {
    if (!confirm("Перевипустити посилання? Старе перестане працювати на всіх телевізорах.")) return;
    setScreen(await api.post<Screen>(`/api/orgs/${org.id}/screens/${screenId}/rotate-token`));
  });

  // Ctrl/Cmd+S зберігає; закрити вкладку чи піти зі сторінки з незбереженим — лише після питання
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty && canEdit && !save.busy) void save.run(undefined); }
    };
    const leave = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("keydown", key); window.addEventListener("beforeunload", leave);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("beforeunload", leave); };
  }, [dirty, canEdit, save.busy]);
  const guardLeave = (e: MouseEvent) => { if (dirty && !confirm(LEAVE)) e.preventDefault(); };

  const selected = useMemo(() => scene?.widgets.find((w) => w.id === sel) ?? null, [scene, sel]);

  if (!screen || !cfg || !scene) return <p className="muted">Завантаження…</p>;
  const idx = cfg.scenes.indexOf(scene);
  const url = screenUrl(screen.viewToken);
  const bgUrl = bgPreview(bgs.list.find((b) => b.id === scene.backgroundId));

  return <div className="editor">
    <div className="editor-top">
      <Link href={`/o/${org.id}/screens`} className="btn btn-ghost" onClick={guardLeave}>← Екрани</Link>
      <input className="name" value={name} onChange={(e) => { setName(e.currentTarget.value); setDirty(true); }} disabled={!canEdit} />
      <span className={`pill ${dirty ? "pill-warn" : "pill-ok"}`}>{dirty ? "не збережено" : "збережено"}</span>
      <div className="grow" />
      <a href={url} target="_blank" rel="noreferrer" className="btn">Відкрити на ТБ ↗</a>
      <Btn onClick={() => navigator.clipboard?.writeText(url)}>Копіювати посилання</Btn>
      {canEdit && <Btn kind="ghost" onClick={() => rotate.run(undefined)} title="Перевипустити посилання">Перевипустити</Btn>}
    </div>
    <ErrorBox err={rotate.err} />
    <ScreenControls org={org} cfg={cfg} scene={scene} radio={radio} bgs={bgs} canEdit={canEdit} update={update} openBackgrounds={() => setBgOpen(true)} />
    <SceneTabs scenes={cfg.scenes} index={idx} canEdit={canEdit} onSelect={selectScene} onChange={(scenes, i) => { update({ scenes }); selectScene(i); }} />
    <div className="editor-body">
      <Canvas widgets={scene.widgets} selected={sel} onSelect={selectWidget} onChange={updateWidget} theme={scene.theme} bgUrl={bgUrl} />
      <aside className="side">
        <div className="seg side-tabs" role="tablist">
          {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        {tab === "widgets" && <>
          <Card title="Додати віджет">
            <div className="chips">{WIDGET_KINDS.map((k) => <button key={k.key ?? k.t} className="chip" disabled={!canEdit || (k.needsDevice && devices.length === 0)} onClick={() => addWidget(k)}>{k.label}</button>)}</div>
            {devices.length === 0 && <p className="muted small">Спершу привʼяжіть пристрій.</p>}
          </Card>
          {selected ? <Card title={`Віджет: ${labelOf(selected.type)}`} actions={canEdit && <Btn kind="danger" onClick={() => removeWidget(selected.id)}>Видалити</Btn>}>
            <WidgetSettings widget={selected} devices={devices} menus={menus} cameras={cameras} theme={scene.theme} onChange={updateWidget} />
          </Card> : <p className="muted small side-hint">Клацніть віджет на полотні, щоб змінити його налаштування. Перетягуйте, щоб пересунути; куточок справа внизу — розмір.</p>}
        </>}
        {tab === "scene" && <Card title={`Сцена: ${sceneTitle(scene, idx)}`}>
          <SceneSettings scene={scene} index={idx} many={cfg.scenes.length > 1} canEdit={canEdit} bgs={bgs} update={updateScene} openBackgrounds={() => setBgOpen(true)} />
        </Card>}
        {tab === "screen" && <>
          <Card title="Екран"><ScreenSettings org={org} screenId={screen.id} cfg={cfg} radio={radio} reloadRadio={reloadRadio} canEdit={canEdit} update={update} /></Card>
          <PairCard org={org} screen={screen} canEdit={canEdit} />
        </>}
      </aside>
    </div>
    {bgOpen && <BackgroundDialog org={org} bgs={bgs} value={scene.backgroundId} sceneName={sceneTitle(scene, idx)} many={cfg.scenes.length > 1} canEdit={canEdit}
      onPick={pickBackground} onClose={() => setBgOpen(false)} />}
    {dirty && canEdit && <div className="savebar" role="status">
      <span className="savebar-dot" />
      <span className="grow">Є незбережені зміни — на ТБ поки попередній вигляд</span>
      <ErrorBox err={save.err} />
      <Btn kind="ghost" onClick={discard} disabled={save.busy}>Скасувати</Btn>
      <Btn kind="primary" onClick={() => save.run(undefined)} disabled={save.busy}>{save.busy ? "Зберігаю…" : "Зберегти"}</Btn>
      <kbd className="muted small">Ctrl+S</kbd>
    </div>}
  </div>;
}
