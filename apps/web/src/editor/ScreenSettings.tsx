/** Вкладка «Екран»: спільне для всіх сцен — порядок ротації, локація, власні станції, відео при радіо, сповіщення. */
import { useEffect, useRef, useState } from "react";
import type { ScreenConfig } from "@deye/shared";
import { ALERT_TESTS } from "@deye/shared/alerts";
import { api, type Org, type OrgRadio, type OwnStation } from "../api.ts";
import { Btn, ErrorBox, Field } from "../components/ui.tsx";
import { LocationPicker } from "./LocationPicker.tsx";

export function ScreenSettings({ org, screenId, cfg, radio, reloadRadio, canEdit, update }: {
  org: Org; screenId: string; cfg: ScreenConfig; radio: OrgRadio; reloadRadio: () => Promise<void>; canEdit: boolean; update: (patch: Partial<ScreenConfig>) => void;
}) {
  const radioAllowed = org.plan.limits.radio;
  const [manage, setManage] = useState(false);
  return <>
    {cfg.scenes.length > 1 && <Field label="Порядок сцен">
      <select value={cfg.rotation} disabled={!canEdit} onChange={(e) => update({ rotation: e.currentTarget.value as "sequence" | "random" })}>
        <option value="sequence">по колу, кожна свій час</option><option value="random">випадково</option>
      </select></Field>}
    <div className="field"><span>Локація (погода, тривоги)</span><LocationPicker value={cfg.location ?? null} onChange={(loc) => update({ location: loc })} canEdit={canEdit} /></div>
    <h3 className="side-h">Радіо</h3>
    {!radioAllowed && <p className="muted small">Радіо недоступне в тарифі.</p>}
    {radioAllowed && <p className="muted small">Увімкнути, вибрати станцію й гучність — на пульті над полотном.</p>}
    {radioAllowed && org.role !== "staff" && <button type="button" className="linklike small" onClick={() => setManage((v) => !v)}>
      {manage ? "Сховати мої станції" : `Мої станції (${radio.own.length}) · додати свою…`}
    </button>}
    {manage && <OwnStations org={org} own={radio.own} reload={reloadRadio} onAdded={(s) => update({ radioUrl: s.url })} />}
    {radioAllowed && <Field label="Відео разом з радіо">
      <select value={cfg.tvVideo ?? "auto"} disabled={!canEdit} onChange={(e) => update({ tvVideo: e.currentTarget.value as "auto" | "always" | "poster" })}>
        <option value="auto">авто (старі Samsung у браузері: кадр замість відео)</option>
        <option value="poster">завжди кадр замість відео</option>
        <option value="always">завжди відео</option>
      </select>
      <span className="muted small">Браузер Samsung Tizen не грає відео і радіо одночасно — в авто-режимі там нерухомий кадр із повільним наїздом. У застосунках SunHunter для Samsung і Android TV грає і те, і те.</span>
    </Field>}
    <h3 className="side-h">Звукові сповіщення</h3>
    <p className="muted small">{cfg.alertSounds ? "Увімкнено" : "Вимкнено"} (перемикач — на пульті). Голосом: повітряна тривога в області екрана (з рівнем — ракетна небезпека чи дронова загроза) і відбій, зникло й зʼявилось світло, потужна генерація — за порогом у налаштуваннях пристрою (% від номіналу панелей); критичний заряд — сигналом. Тривоги потребують локації екрана. У браузері ТБ звук вмикається першою кнопкою пульта, у застосунках — одразу.</p>
    {cfg.alertSounds && <Field label={`Гучність сповіщень ${Math.round((cfg.alertVolume ?? 0.8) * 100)}%`}><input type="range" min={0.1} max={1} step={0.05} value={cfg.alertVolume ?? 0.8} onChange={(e) => update({ alertVolume: +e.currentTarget.value })} disabled={!canEdit} /></Field>}
    {cfg.alertSounds && <TestAlert org={org} screenId={screenId} />}
  </>;
}

/** «Перевірити»: телевізори, що зараз показують екран, програють подію як справжню з банером «Тест». */
function TestAlert({ org, screenId }: { org: Org; screenId: string }) {
  const [kind, setKind] = useState<string>(ALERT_TESTS[0]!.kind);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const run = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.post<{ sent: number }>(`/api/orgs/${org.id}/screens/${screenId}/test-alert`, { kind });
      setMsg(r.sent ? `Надіслано на ${r.sent} ${r.sent === 1 ? "телевізор" : r.sent < 5 ? "телевізори" : "телевізорів"}` : "Зараз цей екран не відкритий на жодному телевізорі");
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return <Field label="Перевірити сповіщення">
    <div className="row small">
      <select value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
        {ALERT_TESTS.map((t) => <option key={t.kind} value={t.kind}>{t.label}</option>)}
      </select>
      <Btn onClick={() => void run()} disabled={busy}>{busy ? "Надсилаю…" : "Перевірити"}</Btn>
    </div>
    {msg && <span className="muted small">{msg}</span>}
    <ErrorBox err={err} />
    <span className="muted small">Звучить на телевізорах, що показують екран зараз, з написом «Тест». Зміни гучності чи ввімкнення спершу збережіть. Якщо браузер ТБ ще не дозволив звук, на екрані зʼявиться підказка натиснути кнопку пульта.</span>
  </Field>;
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
