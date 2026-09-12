import { useEffect, useState } from "react";
import { Link } from "wouter";
import { api, ApiError, type Device, type Org } from "../api.ts";
import { Btn, Card, ErrorBox, Field, ago, useAction } from "../components/ui.tsx";
import { BarChart, Legend, LineChart, type Row } from "../components/charts.tsx";

const PERIODS = [{ id: "day", label: "Доба", hours: 24, step: "5m" }, { id: "week", label: "Тиждень", hours: 7 * 24, step: "1h" }, { id: "month", label: "Місяць", hours: 30 * 24, step: "1h" }] as const;
const POWER = [
  { key: "pv_w", label: "Сонце", color: "#f2b21b", fill: true },
  { key: "load_w", label: "Споживання", color: "#4f8cff" },
  { key: "grid_w", label: "Мережа (+імпорт / −експорт)", color: "#e5484d" },
  { key: "bat_w", label: "Батарея (+розряд / −заряд)", color: "#35c46a" },
];
const SOC = [{ key: "bat_soc", label: "Заряд батареї", color: "#35c46a", fill: true, unit: "%" as const }];
const ENERGY = [
  { key: "pv_day_kwh", label: "Сонце", color: "#f2b21b" }, { key: "load_day_kwh", label: "Спожито", color: "#4f8cff" },
  { key: "grid_buy_day_kwh", label: "З мережі", color: "#e5484d" }, { key: "grid_sell_day_kwh", label: "У мережу", color: "#9b7bff" },
];

export function DeviceDetail({ org, deviceId }: { org: Org; deviceId: string }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(PERIODS[0]);
  const [rows, setRows] = useState<Row[]>([]); const [range, setRange] = useState<[number, number]>([Date.now() - 86400_000, Date.now()]);
  const [daily, setDaily] = useState<{ day: string }[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const allowed = org.plan.limits.history_days > 0;

  useEffect(() => { void api.get<Device[]>(`/api/orgs/${org.id}/devices`).then((l) => setDevice(l.find((d) => d.id === deviceId) ?? null)); }, [org.id, deviceId]);
  useEffect(() => {
    if (!allowed) return;
    setErr(null);
    const to = new Date(); const from = new Date(to.getTime() - period.hours * 3600_000);
    void api.get<{ points: Row[]; from: string; to: string }>(`/api/orgs/${org.id}/devices/${deviceId}/history?metrics=pv_w,load_w,grid_w,bat_w,bat_soc&from=${from.toISOString()}&to=${to.toISOString()}&step=${period.step}`)
      .then((r) => { setRows(r.points); setRange([Date.parse(r.from), Date.parse(r.to)]); }).catch(setErr);
    void api.get<{ day: string }[]>(`/api/orgs/${org.id}/devices/${deviceId}/history/daily?days=${period.id === "month" ? 30 : period.id === "week" ? 7 : 7}`).then(setDaily).catch(() => {});
  }, [org.id, deviceId, period, allowed]);

  const [kwh, setKwh] = useState(""); const [minSoc, setMinSoc] = useState("20");
  useEffect(() => { if (device) { setKwh(device.batteryKwh?.toString() ?? ""); setMinSoc(String(device.minSoc ?? 20)); } }, [device?.id, device?.batteryKwh, device?.minSoc]);
  const saveBat = useAction(async () => {
    const d = await api.patch<Device>(`/api/orgs/${org.id}/devices/${deviceId}`, { batteryKwh: kwh ? Number(kwh) : null, minSoc: Number(minSoc) });
    setDevice((prev) => (prev ? { ...prev, batteryKwh: d.batteryKwh, minSoc: d.minSoc } : prev));
  });
  const m = device?.state ?? {};
  const num = (k: string) => (typeof m[k] === "number" ? (m[k] as number) : null);
  return <>
    <div className="row" style={{ alignItems: "center" }}>
      <Link href={`/o/${org.id}/devices`} className="btn btn-ghost">← Пристрої</Link>
      <h1 style={{ margin: 0 }}>{device?.name ?? deviceId}</h1>
      <span className="muted small">{device ? (device.online ? (device.stale ? "дані застарілі" : "онлайн") : "офлайн") + " · " + ago(device.stateUpdatedAt) : ""}</span>
    </div>
    <div className="kpis">
      {[["Сонце", num("pv_w"), "W"], ["Споживання", num("load_w"), "W"], ["Мережа", num("grid_w"), "W"], ["Батарея", num("bat_soc"), "%"], ["Сьогодні сонце", num("pv_day_kwh"), "kWh"], ["Сьогодні спожито", num("load_day_kwh"), "kWh"]].map(([l, v, u]) =>
        <div key={String(l)} className="kpi"><span className="muted small">{l}</span><b>{v === null ? "—" : u === "W" ? (Math.abs(v as number) >= 1000 ? `${((v as number) / 1000).toFixed(2)} kW` : `${Math.round(v as number)} W`) : `${v} ${u}`}</b></div>)}
    </div>
    <Card title="Батарея та відключення світла">
      <p className="muted small">З ємністю батареї екран покаже персоналу, скільки годин заклад протримається при поточному споживанні. Без неї прогноз рахується за швидкістю розряду.</p>
      <div className="row">
        <Field label="Ємність батареї, kWh"><input type="number" step="0.1" min="0.1" value={kwh} onChange={(e) => setKwh(e.currentTarget.value)} placeholder="напр. 10" disabled={org.role === "staff"} /></Field>
        <Field label="Мінімальний заряд, % (уставка інвертора)"><input type="number" min="0" max="90" value={minSoc} onChange={(e) => setMinSoc(e.currentTarget.value)} disabled={org.role === "staff"} /></Field>
        {org.role !== "staff" && <Btn kind="primary" onClick={() => saveBat.run(undefined)} disabled={saveBat.busy}>Зберегти</Btn>}
      </div>
      <ErrorBox err={saveBat.err} />
    </Card>
    {!allowed ? <Card title="Історія"><p className="muted">Графіки та історія доступні в тарифі Pro.</p></Card> : <>
      <Card title="Потужність" actions={<div className="seg">{PERIODS.map((p) => <button key={p.id} className={p.id === period.id ? "on" : ""} onClick={() => setPeriod(p)}>{p.label}</button>)}</div>}>
        <ErrorBox err={err instanceof ApiError ? err : null} />
        <Legend series={POWER} />
        <LineChart rows={rows} series={POWER} from={range[0]} to={range[1]} />
      </Card>
      <Card title="Заряд батареї"><LineChart rows={rows} series={SOC} from={range[0]} to={range[1]} unit="%" height={160} /></Card>
      <Card title="Енергія по днях, kWh"><Legend series={ENERGY} /><BarChart rows={daily} series={ENERGY} /></Card>
    </>}
  </>;
}
