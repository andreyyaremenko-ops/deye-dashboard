import { menuStyle } from "@deye/shared/menu";
import type { DeviceState } from "./types.ts";
import { estimateRuntime, fmtHours, gridDown } from "@deye/shared/energy";

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

import { ChartWidget } from "./chart.tsx";
import { FlowWidget } from "./flow.tsx";
import { QrWidget } from "./qr.tsx";
import { AlertWidget, EcoWidget, OutageWidget, WeatherWidget } from "./feeds.tsx";
import type { Feeds } from "./types.ts";

interface Props { type: string; state: DeviceState | undefined; props: Record<string, unknown>; token?: string; deviceId?: string;
  device?: { batteryKwh: number | null; minSoc: number; pvKwp?: number | null }; socHistory?: [number, number][];
  feeds?: Feeds; hasLocation?: boolean; outageSince?: number | null }

const NO_DEVICE = new Set(["clock", "text", "qr", "alert", "weather"]);
export function Widget({ type, state, props, token, deviceId, device, socHistory, feeds, hasLocation, outageSince }: Props) {
  const m = state?.metrics;
  // «дані застарілі» стосується лише віджетів інвертора: меню/годинник/QR/тривога/погода не тьмяніють
  const stale = NO_DEVICE.has(type) ? false : !state || state.stale;
  const outage = !!m && gridDown(m);
  const cls = `w w-${type}${stale ? " stale" : ""}${outage ? " outage" : ""}`;
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
      const est = m ? estimateRuntime(m, { capacityKwh: device?.batteryKwh, minSoc: device?.minSoc ?? 20, socHistory }) : null;
      const level = soc === null ? "" : soc <= (device?.minSoc ?? 20) + 10 ? " crit" : soc <= 40 ? " low" : "";
      return <Card cls={cls + level} title="Батарея" stale={stale}>
        <Big>{soc === null ? "—" : `${soc}%`}</Big>
        <div class="bar"><div class="fill" style={{ width: `${soc ?? 0}%` }} /></div>
        <Sub>{dir}{w !== null && dir !== "спокій" ? ` ${fmtW(Math.abs(w))}` : ""}</Sub>
        {est && dir === "розряд" && <div class="runtime">≈ {fmtHours(est.hours)} при поточному споживанні</div>}
      </Card>;
    }
    case "grid": {
      const w = num(m, "grid_w");
      const dir = w === null ? "" : w > 20 ? "з мережі" : w < -20 ? "у мережу" : "баланс";
      if (outage) return <Card cls={cls} title="Мережа" stale={stale}>
        <Big>немає</Big>
        <Sub>світло вимкнено · працюємо від батареї</Sub>
      </Card>;
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
      return <MenuText cls={cls} props={props} />;
    case "runtime": {
      const soc = num(m, "bat_soc");
      const est = m ? estimateRuntime(m, { capacityKwh: device?.batteryKwh, minSoc: device?.minSoc ?? 20, socHistory, assumeLoad: true }) : null;
      const noCap = !device?.batteryKwh;
      return <Card cls={cls + (soc !== null && soc <= (device?.minSoc ?? 20) + 10 ? " crit" : "")} title={outage ? "Автономія" : "Якщо зникне світло"} stale={stale}>
        <Big>{est ? `≈ ${fmtHours(est.hours)}` : noCap ? "—" : "…"}</Big>
        <Sub>{noCap ? "вкажіть ємність батареї в кабінеті" : outage ? "при поточному споживанні" : `батарея ${soc ?? "—"}% · споживання ${fmtW(num(m, "load_w"))}`}</Sub>
      </Card>;
    }
    case "qr":
      return <QrWidget cls={cls} props={props} />;
    case "weather":
      return <WeatherWidget cls={cls} feed={feeds?.weather ?? null} pvKwp={device?.pvKwp} props={{ ...props, noLocation: !hasLocation }} />;
    case "alert":
      return <AlertWidget cls={cls} feed={feeds?.alert ?? null} props={{ ...props, noLocation: !hasLocation }} />;
    case "eco":
      return <EcoWidget cls={cls} token={token ?? ""} deviceId={deviceId} stale={stale} />;
    case "outage": {
      const est = m && outage ? estimateRuntime(m, { capacityKwh: device?.batteryKwh, minSoc: device?.minSoc ?? 20, socHistory }) : null;
      return <OutageWidget cls={cls} outage={outage && !stale} since={outageSince} hours={est?.hours ?? null} soc={num(m, "bat_soc")} props={props} />;
    }
    case "flow": {
      // автономія в підсумковому рядку: лише коли відома ємність батареї
      const est = m && device?.batteryKwh ? estimateRuntime(m, { capacityKwh: device.batteryKwh, minSoc: device.minSoc ?? 20, socHistory, assumeLoad: true }) : null;
      return <FlowWidget cls={cls} state={m} props={props} stale={stale} runtime={est ? fmtHours(est.hours) : null} />;
    }
    case "chart":
      return <ChartWidget token={token ?? ""} deviceId={deviceId} cls={cls} stale={stale} hours={Number(props.hours ?? 24)} />;
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

/**
 * Текст/меню: багато рядків; рядок "Назва — 65" або "Назва ... 65" ділиться на дві колонки.
 * Шрифт, розмір (vw), кольори — з props через menuStyle; внутрішні розміри в em від розміру рядка.
 */
function MenuText({ cls, props }: { cls: string; props: Record<string, unknown> }) {
  const title = String(props.title ?? "").trim();
  const align = String(props.align ?? "left");
  const plain = props.card === false;
  const st = menuStyle(props, props.theme === "light" ? "light" : "dark");
  const lines = String(props.text ?? "").split(/\r?\n/);
  const root: Record<string, string> = { fontFamily: st.fontFamily, fontSize: `${st.fontSize}vw` };
  if (st.color) root.color = st.color;
  if (st.background && !plain) root.background = st.background;
  const accent = st.accent ? { color: st.accent } : undefined;
  return <div class={`${cls} menu menu-${align} menu-font-${st.fontId}${plain ? " menu-plain" : ""}`} style={root}>
    {title && <div class="menu-title" style={accent}>{title}</div>}
    {lines.map((raw, i) => {
      const line = raw.trim();
      if (!line) return <div key={i} class="menu-gap" />;
      if (/^#\s*/.test(line)) return <div key={i} class="menu-sub">{line.replace(/^#\s*/, "")}</div>;
      const m = /^(.*?)\s*(?:[-–—]|\.{2,}|\t)\s*([^\s].{0,12})$/.exec(line);
      if (m && /\d/.test(m[2]!)) return <div key={i} class="menu-row"><span class="menu-name">{m[1]}</span><span class="menu-dots" /><span class="menu-price" style={accent}>{m[2]}</span></div>;
      return <div key={i} class="menu-line">{line}</div>;
    })}
  </div>;
}
