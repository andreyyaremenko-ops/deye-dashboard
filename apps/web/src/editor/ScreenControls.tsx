/** «Пульт» над полотном: те, що міняють найчастіше, — радіо, фон сцени, звукові сповіщення. */
import { useEffect, useState } from "react";
import type { Scene, ScreenConfig } from "@deye/shared";
import type { Org, OrgRadio } from "../api.ts";
import { bgPreview, type Backgrounds } from "./useBackgrounds.ts";

export function ScreenControls({ org, cfg, scene, radio, bgs, canEdit, update, openBackgrounds }: {
  org: Org; cfg: ScreenConfig; scene: Scene; radio: OrgRadio; bgs: Backgrounds; canEdit: boolean;
  update: (patch: Partial<ScreenConfig>) => void; openBackgrounds: () => void;
}) {
  const radioAllowed = org.plan.limits.radio;
  const stations = [...radio.own.map((r) => ({ url: r.url, title: r.title })), ...radio.catalog];
  // вимкнене радіо пам'ятає станцію, щоб ▶ вмикав ту саму, а не першу зі списку
  const [last, setLast] = useState<string | null>(cfg.radioUrl ?? stations[0]?.url ?? null);
  useEffect(() => { if (cfg.radioUrl) setLast(cfg.radioUrl); else if (!last && stations[0]) setLast(stations[0].url); }, [cfg.radioUrl, stations.length]);
  const on = !!cfg.radioUrl;
  const current = cfg.radioUrl ?? last ?? "";
  const known = stations.some((s) => s.url === current);
  const bg = bgs.list.find((b) => b.id === scene.backgroundId);
  const thumb = bgPreview(bg);

  return <div className="ctl">
    <div className={`ctl-group ctl-radio${on ? " on" : ""}`}>
      <button type="button" className="ctl-play" disabled={!canEdit || !radioAllowed || !current} onClick={() => update({ radioUrl: on ? null : current })}
        title={radioAllowed ? (on ? "Вимкнути радіо" : "Увімкнути радіо") : "Радіо недоступне в тарифі"}>{on ? "■" : "▶"}</button>
      <div className="ctl-col">
        <span className="ctl-label">Радіо · {on ? "грає" : "вимкнено"}</span>
        <select value={current} disabled={!canEdit || !radioAllowed} onChange={(e) => { setLast(e.currentTarget.value); update({ radioUrl: e.currentTarget.value }); }}>
          {!!radio.own.length && <optgroup label="Ваші станції">{radio.own.map((r) => <option key={r.id} value={r.url}>{r.title}</option>)}</optgroup>}
          <optgroup label="Каталог">{radio.catalog.map((r) => <option key={r.id} value={r.url}>{r.title}</option>)}</optgroup>
          {current && !known && <option value={current}>{current}</option>}
        </select>
      </div>
      {on && <label className="ctl-vol" title={`Гучність ${Math.round(cfg.radioVolume * 100)}%`}>
        <span className="ctl-label">🔊 {Math.round(cfg.radioVolume * 100)}%</span>
        <input type="range" min={0} max={1} step={0.05} value={cfg.radioVolume} disabled={!canEdit} onChange={(e) => update({ radioVolume: +e.currentTarget.value })} />
      </label>}
    </div>

    <button type="button" className="ctl-group ctl-bg" onClick={openBackgrounds} disabled={!canEdit} title="Змінити фон сцени">
      <span className="ctl-thumb" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined} />
      <span className="ctl-col">
        <span className="ctl-label">Фон сцени</span>
        <span className="ctl-val">{bg ? bg.name : "без фону"}</span>
      </span>
      <span className="ctl-act">Змінити</span>
    </button>

    <button type="button" className={`ctl-group ctl-toggle${cfg.alertSounds ? " on" : ""}`} disabled={!canEdit} onClick={() => update({ alertSounds: !cfg.alertSounds })}
      title="Голосом: тривога й відбій, світло зникло/зʼявилось, потужна генерація. Деталі й перевірка — вкладка «Екран».">
      <span className="ctl-ico">{cfg.alertSounds ? "🔔" : "🔕"}</span>
      <span className="ctl-col">
        <span className="ctl-label">Сповіщення</span>
        <span className="ctl-val">{cfg.alertSounds ? "голос увімкнено" : "вимкнено"}</span>
      </span>
    </button>
  </div>;
}
