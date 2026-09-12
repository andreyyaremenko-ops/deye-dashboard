import type { DeviceState } from "./types.ts";

type M = Record<string, number | string | boolean>;
const num = (m: M | undefined, k: string): number | null => (typeof m?.[k] === "number" ? (m[k] as number) : null);

export function fmtW(w: number | null): string {
  if (w === null) return "—";
  const a = Math.abs(w);
  return a >= 10000 ? `${(w / 1000).toFixed(1)} kW` : a >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
}
const fmtKwh = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} kWh`);

/** Ніч: інвертор спить або PV = 0 при state != normal — показуємо не нулі, а що є. */
function isNight(m: M | undefined): boolean {
  if (!m) return false;
  const state = m.state;
  return state === "standby" || (state !== "normal" && (num(m, "pv_w") ?? 0) === 0);
}

interface Props { type: string; state: DeviceState | undefined; props: Record<string, unknown> }

export function Widget({ type, state, props }: Props) {
  const m = state?.metrics;
  const stale = !state || state.stale;
  const cls = `w w-${type}${stale ? " stale" : ""}`;
  switch (type) {
    case "pv": {
      const pv = num(m, "pv_w");
      const night = isNight(m);
      return <Card cls={cls} title="Сонце" stale={stale}>
        <Big>{night ? "ніч" : fmtW(pv)}</Big>
        <Sub>сьогодні {fmtKwh(num(m, "pv_day_kwh"))}</Sub>
      </Card>;
    }
    case "battery": {
      const soc = num(m, "bat_soc"); const w = num(m, "bat_w");
      const dir = w === null ? "" : w > 20 ? "розряд" : w < -20 ? "заряд" : "спокій";
      return <Card cls={cls} title="Батарея" stale={stale}>
        <Big>{soc === null ? "—" : `${soc}%`}</Big>
        <div class="bar"><div class="fill" style={{ width: `${soc ?? 0}%` }} /></div>
        <Sub>{dir}{w !== null && dir !== "спокій" ? ` ${fmtW(Math.abs(w))}` : ""}</Sub>
      </Card>;
    }
    case "grid": {
      const w = num(m, "grid_w");
      const dir = w === null ? "" : w > 20 ? "з мережі" : w < -20 ? "у мережу" : "баланс";
      return <Card cls={cls} title="Мережа" stale={stale}>
        <Big>{fmtW(w === null ? null : Math.abs(w))}</Big>
        <Sub>{dir}{num(m, "grid_hz") !== null ? ` · ${(num(m, "grid_hz") as number).toFixed(1)} Hz` : ""}</Sub>
      </Card>;
    }
    case "load":
      return <Card cls={cls} title="Споживання" stale={stale}>
        <Big>{fmtW(num(m, "load_w"))}</Big>
        <Sub>сьогодні {fmtKwh(num(m, "load_day_kwh"))}</Sub>
      </Card>;
    case "energy_today":
      return <Card cls={cls} title="Сьогодні" stale={stale}>
        <Row k="Сонце" v={fmtKwh(num(m, "pv_day_kwh"))} />
        <Row k="Спожито" v={fmtKwh(num(m, "load_day_kwh"))} />
        <Row k="З мережі" v={fmtKwh(num(m, "grid_buy_day_kwh"))} />
        <Row k="У мережу" v={fmtKwh(num(m, "grid_sell_day_kwh"))} />
      </Card>;
    case "clock":
      return <Clock cls={cls} />;
    case "text":
      return <div class={cls}><div class="text">{String(props.text ?? "")}</div></div>;
    default:
      return <div class={cls}><div class="text">?{type}</div></div>;
  }
}

function Card({ cls, title, stale, children }: { cls: string; title: string; stale: boolean; children: preact.ComponentChildren }) {
  return <div class={cls}>
    <div class="title">{title}{stale && <span class="badge">дані застарілі</span>}</div>
    {children}
  </div>;
}
const Big = ({ children }: { children: preact.ComponentChildren }) => <div class="big">{children}</div>;
const Sub = ({ children }: { children: preact.ComponentChildren }) => <div class="sub">{children}</div>;
const Row = ({ k, v }: { k: string; v: string }) => <div class="row"><span>{k}</span><b>{v}</b></div>;

import { useEffect, useState } from "preact/hooks";
function Clock({ cls }: { cls: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const hh = String(now.getHours()).padStart(2, "0"), mm = String(now.getMinutes()).padStart(2, "0");
  return <div class={cls}>
    <div class="big">{hh}:{mm}</div>
    <div class="sub">{now.toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })}</div>
  </div>;
}
