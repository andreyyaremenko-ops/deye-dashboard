/** Вкладки сцен над полотном: вибір, додавання, дублювання, порядок, видалення. */
import type { Scene } from "@deye/shared";
import { MAX_SCENES } from "@deye/shared/scenes";

export const sceneTitle = (s: Scene, i: number) => s.name.trim() || `Сцена ${i + 1}`;
const newId = () => `s-${Math.random().toString(36).slice(2, 8)}`;
/** Копія сцени з новими id (сцени й віджетів), щоб ключі не збігались. */
const cloneScene = (s: Scene, name: string): Scene => ({ ...s, id: newId(), name, widgets: s.widgets.map((w) => ({ ...w, id: `${w.type}-${Math.random().toString(36).slice(2, 7)}`, props: { ...w.props } })) });

export function SceneTabs({ scenes, index, canEdit, onSelect, onChange }: { scenes: Scene[]; index: number; canEdit: boolean; onSelect: (i: number) => void; onChange: (scenes: Scene[], select: number) => void }) {
  const full = scenes.length >= MAX_SCENES;
  const cur = scenes[index]!;
  const add = () => onChange([...scenes, { id: newId(), name: "", durationS: 30, backgroundId: cur.backgroundId, theme: cur.theme, widgets: [], schedule: null, onOutage: false }], scenes.length);
  const dup = () => { const copy = cloneScene(cur, `${sceneTitle(cur, index)} (копія)`); const next = [...scenes]; next.splice(index + 1, 0, copy); onChange(next, index + 1); };
  const del = () => { if (scenes.length > 1 && confirm(`Видалити «${sceneTitle(cur, index)}»?`)) onChange(scenes.filter((_, i) => i !== index), Math.max(0, index - 1)); };
  const move = (d: -1 | 1) => { const j = index + d; if (j < 0 || j >= scenes.length) return; const next = [...scenes]; [next[index], next[j]] = [next[j]!, next[index]!]; onChange(next, j); };
  return <div className="scene-tabs">
    <div className="scene-list">
      {scenes.map((s, i) => <button key={s.id} className={`scene-tab${i === index ? " on" : ""}`} onClick={() => onSelect(i)} title={`${s.durationS} с${s.schedule ? ` · ${s.schedule.from}–${s.schedule.to}` : ""}${s.onOutage ? " · при відключенні" : ""}`}>
        <span className="scene-n">{i + 1}</span>{sceneTitle(s, i)}
        <small>{s.durationS} с{s.schedule ? " ⏱" : ""}{s.onOutage ? " ⚡" : ""}</small>
      </button>)}
      {canEdit && <button className="scene-tab scene-add" onClick={add} disabled={full} title={full ? `Не більше ${MAX_SCENES} сцен` : "Нова порожня сцена"}>+ Сцена</button>}
    </div>
    {canEdit && <div className="scene-ops">
      <button className="btn btn-ghost btn-sm" onClick={() => move(-1)} disabled={index === 0} title="Раніше в черзі">←</button>
      <button className="btn btn-ghost btn-sm" onClick={() => move(1)} disabled={index === scenes.length - 1} title="Пізніше в черзі">→</button>
      <button className="btn btn-ghost btn-sm" onClick={dup} disabled={full}>Дублювати</button>
      <button className="btn btn-ghost btn-sm" onClick={del} disabled={scenes.length < 2}>Видалити</button>
    </div>}
  </div>;
}
