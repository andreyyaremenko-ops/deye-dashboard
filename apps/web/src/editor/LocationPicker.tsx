/** Локація екрана: пошук міста через геокодер API + область для тривог. */
import { useEffect, useState } from "react";
import type { ScreenLocation } from "@deye/shared";
import { api } from "../api.ts";
import { Btn } from "../components/ui.tsx";

type Hit = { name: string; lat: number; lon: number; oblast: string | null };

export function LocationPicker({ value, onChange, canEdit }: { value: ScreenLocation | null; onChange: (v: ScreenLocation | null) => void; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [oblasts, setOblasts] = useState<string[]>([]);
  useEffect(() => { void api.get<string[]>("/api/oblasts").then(setOblasts).catch(() => {}); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      setBusy(true);
      api.get<Hit[]>(`/api/geocode?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([])).finally(() => setBusy(false));
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  if (value) return <div className="loc">
    <div className="loc-cur"><b>{value.name}</b><span className="muted small"> · {value.lat.toFixed(3)}, {value.lon.toFixed(3)}</span></div>
    <div className="row small">
      <label className="field"><span>Область для тривог</span>
        <select value={value.oblast ?? ""} disabled={!canEdit} onChange={(e) => onChange({ ...value, oblast: e.currentTarget.value || null })}>
          <option value="">не показувати тривоги</option>
          {oblasts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select></label>
      {canEdit && <Btn kind="ghost" onClick={() => onChange(null)}>Змінити</Btn>}
    </div>
  </div>;

  return <div className="loc">
    <input value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder="Місто або селище, напр. Баришівка" disabled={!canEdit} />
    {busy && <p className="muted small">Шукаю…</p>}
    {hits.length > 0 && <div className="loc-hits">{hits.map((h, i) => <button key={i} type="button" className="loc-hit" onClick={() => { onChange({ name: h.name, lat: h.lat, lon: h.lon, oblast: h.oblast }); setQ(""); setHits([]); }}>{h.name}</button>)}</div>}
    {!busy && q.trim().length >= 2 && hits.length === 0 && <p className="muted small">Нічого не знайдено</p>}
    <p className="muted small">Потрібна віджетам «Погода» і «Тривога».</p>
  </div>;
}
