/** Картка «Екран»: спільне для всіх сцен — порядок ротації, локація, радіо і режим відео при радіо. */
import type { ScreenConfig } from "@deye/shared";
import type { Org, RadioStation } from "../api.ts";
import { Field } from "../components/ui.tsx";
import { LocationPicker } from "./LocationPicker.tsx";

export function ScreenSettings({ org, cfg, radio, canEdit, update }: { org: Org; cfg: ScreenConfig; radio: RadioStation[]; canEdit: boolean; update: (patch: Partial<ScreenConfig>) => void }) {
  const radioAllowed = org.plan.limits.radio;
  return <>
    {cfg.scenes.length > 1 && <Field label="Порядок сцен">
      <select value={cfg.rotation} disabled={!canEdit} onChange={(e) => update({ rotation: e.currentTarget.value as "sequence" | "random" })}>
        <option value="sequence">по колу, кожна свій час</option><option value="random">випадково</option>
      </select></Field>}
    <div className="field"><span>Локація (погода, тривоги)</span><LocationPicker value={cfg.location ?? null} onChange={(loc) => update({ location: loc })} canEdit={canEdit} /></div>
    <Field label={`Радіо${radioAllowed ? "" : " (недоступно в тарифі)"}`}>
      <select value={cfg.radioUrl ?? ""} disabled={!canEdit || !radioAllowed} onChange={(e) => update({ radioUrl: e.currentTarget.value || null })}>
        <option value="">Вимкнено</option>
        {radio.map((r) => <option key={r.id} value={r.url}>{r.title}</option>)}
      </select></Field>
    {cfg.radioUrl && <Field label="Відео разом з радіо">
      <select value={cfg.tvVideo ?? "auto"} disabled={!canEdit} onChange={(e) => update({ tvVideo: e.currentTarget.value as "auto" | "always" | "poster" })}>
        <option value="auto">авто (Samsung: кадр замість відео)</option>
        <option value="poster">завжди кадр замість відео</option>
        <option value="always">завжди відео</option>
      </select>
      <span className="muted small">Деякі ТБ (Samsung Tizen) не грають відео і радіо одночасно. В авто-режимі екран сам переходить на нерухомий кадр із повільним наїздом.</span>
    </Field>}
    {cfg.radioUrl && <Field label={`Гучність ${Math.round(cfg.radioVolume * 100)}%`}><input type="range" min={0} max={1} step={0.05} value={cfg.radioVolume} onChange={(e) => update({ radioVolume: +e.currentTarget.value })} disabled={!canEdit} /></Field>}
  </>;
}
