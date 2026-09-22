/** Картка «Екран»: спільне для всіх сцен — порядок ротації, локація, радіо і режим відео при радіо. */
import { useEffect, useRef, useState } from "react";
import type { ScreenConfig } from "@deye/shared";
import { api, type Org, type OrgRadio, type OwnStation } from "../api.ts";
import { Btn, ErrorBox, Field } from "../components/ui.tsx";
import { LocationPicker } from "./LocationPicker.tsx";

export function ScreenSettings({ org, cfg, radio, reloadRadio, canEdit, update }: {
  org: Org; cfg: ScreenConfig; radio: OrgRadio; reloadRadio: () => Promise<void>; canEdit: boolean; update: (patch: Partial<ScreenConfig>) => void;
}) {
  const radioAllowed = org.plan.limits.radio;
  const [manage, setManage] = useState(false);
  // радіо з адресою, якої вже немає ні в каталозі, ні серед своїх (станцію видалили) — показуємо як є, щоб select не брехав
  const known = radio.catalog.some((r) => r.url === cfg.radioUrl) || radio.own.some((r) => r.url === cfg.radioUrl);
  return <>
    {cfg.scenes.length > 1 && <Field label="Порядок сцен">
      <select value={cfg.rotation} disabled={!canEdit} onChange={(e) => update({ rotation: e.currentTarget.value as "sequence" | "random" })}>
        <option value="sequence">по колу, кожна свій час</option><option value="random">випадково</option>
      </select></Field>}
    <div className="field"><span>Локація (погода, тривоги)</span><LocationPicker value={cfg.location ?? null} onChange={(loc) => update({ location: loc })} canEdit={canEdit} /></div>
    <Field label={`Радіо${radioAllowed ? "" : " (недоступно в тарифі)"}`}>
      <select value={cfg.radioUrl ?? ""} disabled={!canEdit || !radioAllowed} onChange={(e) => update({ radioUrl: e.currentTarget.value || null })}>
        <option value="">Вимкнено</option>
        {!!radio.own.length && <optgroup label="Ваші станції">
          {radio.own.map((r) => <option key={r.id} value={r.url}>{r.title}</option>)}
        </optgroup>}
        <optgroup label="Каталог">
          {radio.catalog.map((r) => <option key={r.id} value={r.url}>{r.title}</option>)}
        </optgroup>
        {cfg.radioUrl && !known && <option value={cfg.radioUrl}>{cfg.radioUrl}</option>}
      </select>
      {radioAllowed && org.role !== "staff" && <button type="button" className="linklike small" onClick={() => setManage((v) => !v)}>
        {manage ? "Сховати мої станції" : "+ Своя станція…"}
      </button>}
    </Field>
    {manage && <OwnStations org={org} own={radio.own} reload={reloadRadio} onAdded={(s) => update({ radioUrl: s.url })} />}
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

/** Власні станції закладу: додати за адресою стріму (сервер перевіряє), прослухати, видалити. */
function OwnStations({ org, own, reload, onAdded }: { org: Org; own: OwnStation[]; reload: () => Promise<void>; onAdded: (s: OwnStation) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const limit = org.plan.limits.custom_radio ?? 5;
  useEffect(() => () => { audio.current?.pause(); }, []);

  const listen = (s: OwnStation) => {
    audio.current?.pause();
    if (playing === s.id) { setPlaying(null); return; }
    const a = new Audio(s.url); a.volume = 0.6; audio.current = a;
    a.play().then(() => setPlaying(s.id)).catch(() => { setPlaying(null); setErr(new Error("Браузер не зміг відтворити стрім")); });
  };
  const add = async () => {
    setBusy(true); setErr(null);
    try {
      const s = await api.post<OwnStation>(`/api/orgs/${org.id}/radio`, { url, title: title || undefined });
      await reload(); onAdded(s); setUrl(""); setTitle("");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const del = async (s: OwnStation) => {
    if (!confirm(`Видалити станцію «${s.title}»?`)) return;
    setErr(null);
    try { if (playing === s.id) { audio.current?.pause(); setPlaying(null); } await api.del(`/api/orgs/${org.id}/radio/${s.id}`); await reload(); }
    catch (e) { setErr(e); }
  };

  return <div className="own-radio">
    {own.map((s) => <div key={s.id} className="own-radio-row">
      <button type="button" className="btn btn-xs" onClick={() => listen(s)} title="Прослухати тут">{playing === s.id ? "■" : "▶"}</button>
      <span className="grow" title={s.url}>{s.title}</span>
      <button type="button" className="btn btn-xs" onClick={() => void del(s)} title="Видалити">✕</button>
    </div>)}
    {own.length < limit ? <>
      <Field label="Адреса стріму">
        <input value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://… (.mp3, /stream, .m3u, .pls)" />
      </Field>
      <div className="row small">
        <Field label="Назва (необовʼязково)"><input value={title} onChange={(e) => setTitle(e.currentTarget.value)} placeholder="візьмемо зі стріму" /></Field>
        <Btn onClick={() => void add()} disabled={busy || url.trim().length < 8}>{busy ? "Перевіряємо…" : "Перевірити і додати"}</Btn>
      </div>
      <p className="muted small">Потрібне пряме посилання на потік по https. Плейлисти .m3u/.pls розгорнемо самі. Станції: {own.length} з {limit}.</p>
    </> : <p className="muted small">Досягнуто ліміту тарифу: {limit} власних станцій.</p>}
    <ErrorBox err={err} />
  </div>;
}
