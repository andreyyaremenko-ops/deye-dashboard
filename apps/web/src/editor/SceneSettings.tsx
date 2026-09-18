/** Картка «Сцена»: назва, тривалість показу, розклад за годинами, пріоритет при відключенні, тема і фон. */
import type { Scene } from "@deye/shared";
import type { Org } from "../api.ts";
import { Field } from "../components/ui.tsx";
import { BackgroundPicker } from "./BackgroundPicker.tsx";

export function SceneSettings({ org, scene, index, many, canEdit, update }: { org: Org; scene: Scene; index: number; many: boolean; canEdit: boolean; update: (patch: Partial<Scene>) => void }) {
  const sch = scene.schedule;
  return <>
    <div className="row small">
      <Field label="Назва"><input value={scene.name} maxLength={60} placeholder={`Сцена ${index + 1}`} onChange={(e) => update({ name: e.currentTarget.value })} disabled={!canEdit} /></Field>
      <Field label="Показувати, с"><input type="number" min={5} max={3600} step={5} value={scene.durationS} disabled={!canEdit}
        onChange={(e) => update({ durationS: Math.max(5, Math.min(3600, Math.round(+e.currentTarget.value || 30))) })} /></Field>
    </div>
    <Field label="Коли показувати">
      <select value={sch ? "1" : "0"} disabled={!canEdit} onChange={(e) => update({ schedule: e.currentTarget.value === "1" ? { from: "08:00", to: "12:00" } : null })}>
        <option value="0">завжди</option><option value="1">лише в певні години</option>
      </select></Field>
    {sch && <div className="row small">
      <Field label="З"><input type="time" value={sch.from} disabled={!canEdit} onChange={(e) => e.currentTarget.value && update({ schedule: { ...sch, from: e.currentTarget.value } })} /></Field>
      <Field label="До"><input type="time" value={sch.to} disabled={!canEdit} onChange={(e) => e.currentTarget.value && update({ schedule: { ...sch, to: e.currentTarget.value } })} /></Field>
    </div>}
    <Field label="Під час відключення світла">
      <select value={scene.onOutage ? "1" : "0"} disabled={!canEdit} onChange={(e) => update({ onOutage: e.currentTarget.value === "1" })}>
        <option value="0">як зазвичай</option><option value="1">показувати лише цю сцену</option>
      </select></Field>
    {many && <p className="muted small">Години — за годинником телевізора. Інтервал може переходити через північ. Якщо жодна сцена не підходить за часом, показується перша.</p>}
    <Field label="Тема"><select value={scene.theme} onChange={(e) => update({ theme: e.currentTarget.value as "dark" | "light" })} disabled={!canEdit}><option value="dark">Темна</option><option value="light">Світла</option></select></Field>
    <div className="field"><span>Фон</span><BackgroundPicker org={org} value={scene.backgroundId} onChange={(id) => update({ backgroundId: id })} canEdit={canEdit} /></div>
  </>;
}
