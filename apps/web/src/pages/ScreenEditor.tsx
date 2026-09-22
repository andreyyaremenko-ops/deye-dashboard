/** Редактор екрана: полотно з віджетами, панель властивостей, налаштування екрана, підключення ТБ. */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { screenConfigSchema, type Scene, type ScreenConfig } from "@deye/shared";
import { api, screenUrl, type Device, type MenuSummary, type Org, type OrgRadio, type Screen } from "../api.ts";
import { Btn, Card, ErrorBox, useAction } from "../components/ui.tsx";
import { Canvas } from "../editor/Canvas.tsx";
import { WidgetSettings } from "../editor/WidgetSettings.tsx";
import { ScreenSettings } from "../editor/ScreenSettings.tsx";
import { SceneSettings } from "../editor/SceneSettings.tsx";
import { SceneTabs, sceneTitle } from "../editor/SceneTabs.tsx";
import { PairCard } from "../editor/PairCard.tsx";
import { WIDGET_KINDS, labelOf, newWidget, type Widget, type WidgetKind } from "../editor/widgetTypes.ts";

export function ScreenEditor({ org, screenId }: { org: Org; screenId: string }) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [cfg, setCfg] = useState<ScreenConfig | null>(null);
  const [name, setName] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [radio, setRadio] = useState<OrgRadio>({ catalog: [], own: [] });
  const reloadRadio = async () => setRadio(await api.get<OrgRadio>(`/api/orgs/${org.id}/radio`));
  const [sel, setSel] = useState<string | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [dirty, setDirty] = useState(false);
  const canEdit = org.role !== "staff";

  useEffect(() => {
    void (async () => {
      const [list, devs, st, mns] = await Promise.all([api.get<Screen[]>(`/api/orgs/${org.id}/screens`), api.get<Device[]>(`/api/orgs/${org.id}/devices`), api.get<OrgRadio>(`/api/orgs/${org.id}/radio`), api.get<MenuSummary[]>(`/api/orgs/${org.id}/menus`).catch(() => [])]);
      const s = list.find((x) => x.id === screenId) ?? null;
      setScreen(s); setCfg(s ? screenConfigSchema.parse(s.config) : null); setName(s?.name ?? ""); setDevices(devs); setRadio(st); setMenus(mns);
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

  const save = useAction(async () => {
    const s = await api.patch<Screen>(`/api/orgs/${org.id}/screens/${screenId}`, { name, config: cfg });
    setScreen(s); setCfg(screenConfigSchema.parse(s.config)); setDirty(false);
  });
  const rotate = useAction(async () => {
    if (!confirm("Перевипустити посилання? Старе перестане працювати на всіх телевізорах.")) return;
    setScreen(await api.post<Screen>(`/api/orgs/${org.id}/screens/${screenId}/rotate-token`));
  });
  const selected = useMemo(() => scene?.widgets.find((w) => w.id === sel) ?? null, [scene, sel]);

  if (!screen || !cfg || !scene) return <p className="muted">Завантаження…</p>;
  const idx = cfg.scenes.indexOf(scene);
  const url = screenUrl(screen.viewToken);

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
    <SceneTabs scenes={cfg.scenes} index={idx} canEdit={canEdit} onSelect={selectScene} onChange={(scenes, i) => { update({ scenes }); selectScene(i); }} />
    <div className="editor-body">
      <Canvas widgets={scene.widgets} selected={sel} onSelect={setSel} onChange={updateWidget} theme={scene.theme} />
      <aside className="side">
        <Card title="Додати віджет">
          <div className="chips">{WIDGET_KINDS.map((k) => <button key={k.key ?? k.t} className="chip" disabled={!canEdit || (k.needsDevice && devices.length === 0)} onClick={() => addWidget(k)}>{k.label}</button>)}</div>
          {devices.length === 0 && <p className="muted small">Спершу привʼяжіть пристрій.</p>}
        </Card>
        {selected && <Card title={`Віджет: ${labelOf(selected.type)}`} actions={canEdit && <Btn kind="danger" onClick={() => removeWidget(selected.id)}>Видалити</Btn>}>
          <WidgetSettings widget={selected} devices={devices} menus={menus} theme={scene.theme} onChange={updateWidget} />
        </Card>}
        <Card title={`Сцена: ${sceneTitle(scene, idx)}`}><SceneSettings org={org} scene={scene} index={idx} many={cfg.scenes.length > 1} canEdit={canEdit} update={updateScene} /></Card>
        <Card title="Екран"><ScreenSettings org={org} cfg={cfg} radio={radio} reloadRadio={reloadRadio} canEdit={canEdit} update={update} /></Card>
        <PairCard org={org} screen={screen} canEdit={canEdit} />
      </aside>
    </div>
  </div>;
}
