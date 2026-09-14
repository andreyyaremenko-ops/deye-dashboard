/** Віджети зовнішніх стрічок: погода з прогнозом сонця, тривога, еко-статистика, банер відключення. */
import { useEffect, useState } from "preact/hooks";
import { pvForecastKwh, wmoLabel, type AlertFeed, type WeatherFeed } from "@deye/shared/feeds";
import { fmtHours } from "@deye/shared/energy";

const hhmm = (iso: string | number | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const fmtKwh = (v: number) => (v >= 100 ? Math.round(v).toLocaleString("uk-UA") : v.toFixed(1)) + " kWh";

export function WeatherWidget({ cls, feed, pvKwp, props }: { cls: string; feed: WeatherFeed | null; pvKwp: number | null | undefined; props: Record<string, unknown> }) {
  if (!feed) return <div class={`${cls} w-weather`}><div class="title">Погода</div><div class="sub">{props.noLocation ? "вкажіть локацію екрана в кабінеті" : "немає даних"}</div></div>;
  const cur = wmoLabel(feed.current.code, feed.current.isDay);
  const today = feed.daily[0], tomorrow = feed.daily[1];
  const tl = tomorrow ? wmoLabel(tomorrow.code) : null;
  const fc = tomorrow && pvKwp ? pvForecastKwh(tomorrow.sunKwhM2, pvKwp) : null;
  return <div class={`${cls} w-weather`}>
    <div class="title">Погода{today ? ` · захід ${hhmm(today.sunset)}` : ""}</div>
    <div class="wx-now"><span class="wx-icon">{cur.icon}</span><span class="big">{Math.round(feed.current.temp)}°</span><span class="wx-desc">{cur.text}<br /><small>вітер {Math.round(feed.current.windKmh)} км/год</small></span></div>
    {tomorrow && tl && <div class="wx-row"><span>завтра</span><b>{tl.icon} {Math.round(tomorrow.tmin)}…{Math.round(tomorrow.tmax)}°</b><span class="wx-t">{tl.text}</span></div>}
    {fc !== null && <div class="wx-row sun"><span>сонце завтра</span><b>≈ {fmtKwh(fc)}</b><span class="wx-t">{fc >= pvKwp! * 3 ? "гарний день" : fc >= pvKwp! * 1.5 ? "середньо" : "мало сонця"}</span></div>}
    {fc === null && tomorrow && <div class="wx-row sun"><span>сонце завтра</span><b>{tomorrow.sunKwhM2.toFixed(1)} кВт·год/м²</b></div>}
  </div>;
}

const levelText = (l: AlertFeed["level"]) => (l === "red" ? "ракетна загроза" : l === "yellow" ? "дронова загроза" : "");

/** Картка тривоги: червона під час тривоги, тиха зелена — без. */
export function AlertWidget({ cls, feed, props }: { cls: string; feed: AlertFeed | null; props: Record<string, unknown> }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  if (!feed) return <div class={`${cls} w-alert`}><div class="title">Тривога</div><div class="sub">{props.noLocation ? "вкажіть область екрана в кабінеті" : "немає даних"}</div></div>;
  const stale = Date.now() - Date.parse(feed.updatedAt) > 5 * 60_000;
  const dur = feed.since ? Math.max(0, (Date.now() - Date.parse(feed.since)) / 3600_000) : null;
  return <div class={`${cls} w-alert${feed.active ? " on" : " off"}`}>
    <div class="title">{feed.oblast}{stale && <span class="badge">дані застарілі</span>}</div>
    <div class="big">{feed.active ? (feed.level === "yellow" ? "🟡 Тривога" : "🔴 Тривога") : "🟢 Тривоги немає"}</div>
    <div class="sub">{feed.active ? [feed.since ? `з ${hhmm(feed.since)}${dur !== null && dur >= 0.25 ? ` · ${fmtHours(dur)}` : ""}` : "", levelText(feed.level), "пройдіть в укриття"].filter(Boolean).join(" · ") : feed.since ? `відбій о ${hhmm(feed.since)}` : ""}</div>
  </div>;
}

/** Повноекранний банер тривоги; після відбою 3 хв показуємо зелений. */
export function AlertOverlay({ feed }: { feed: AlertFeed | null }) {
  const [clearedAt, setClearedAt] = useState<number | null>(null);
  const [wasActive, setWasActive] = useState(false);
  useEffect(() => {
    if (feed?.active) { setWasActive(true); setClearedAt(null); }
    else if (wasActive) { setWasActive(false); setClearedAt(Date.now()); }
  }, [feed?.active]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 10_000); return () => clearInterval(t); }, []);
  if (feed?.active) return <div class="alert-overlay on">
    <div class="alert-icon">🚨</div>
    <div class="alert-h">ПОВІТРЯНА ТРИВОГА</div>
    <div class="alert-s">{feed.oblast}{feed.since ? ` · з ${hhmm(feed.since)}` : ""}{feed.level ? ` · ${levelText(feed.level)}` : ""}</div>
    <div class="alert-t">Пройдіть в укриття</div>
  </div>;
  if (clearedAt && Date.now() - clearedAt < 3 * 60_000) return <div class="alert-overlay off">
    <div class="alert-h">ВІДБІЙ ТРИВОГИ</div>
    <div class="alert-s">{feed?.oblast ?? ""}</div>
  </div>;
  return null;
}

interface Stats { month: string; since: string; sinceDays: number; pvMonthKwh: number | null; loadMonthKwh: number | null; gridBuyMonthKwh: number | null; pvPrevMonthKwh: number | null; pvTotalKwh: number | null; co2MonthKg: number | null }
const MONTHS = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];

export function EcoWidget({ cls, token, deviceId, stale }: { cls: string; token: string; deviceId?: string; stale: boolean }) {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    if (!deviceId) return;
    let stop = false;
    const load = () => fetch(`/api/public/screens/${encodeURIComponent(token)}/stats?deviceId=${encodeURIComponent(deviceId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (!stop && j) setS(j as Stats); }).catch(() => {});
    load(); const t = setInterval(load, 10 * 60_000);
    return () => { stop = true; clearInterval(t); };
  }, [token, deviceId]);
  const month = s ? MONTHS[Number(s.month.slice(5)) - 1] : "";
  const trees = s?.co2MonthKg ? Math.round(s.co2MonthKg / 1.8) : null;   // ≈ 21 кг CO₂ на дерево на рік
  return <div class={`${cls} w-eco`}>
    <div class="title">Сонце за {month || "місяць"}{stale && <span class="badge">дані застарілі</span>}</div>
    <div class="big">{s?.pvMonthKwh !== null && s?.pvMonthKwh !== undefined ? fmtKwh(s.pvMonthKwh) : "—"}</div>
    <div class="sub">{s?.co2MonthKg ? `≈ ${s.co2MonthKg.toLocaleString("uk-UA")} кг CO₂ не потрапило в повітря` : s ? `рахуємо з ${new Date(s.since).toLocaleDateString("uk-UA")}` : ""}</div>
    {s?.pvPrevMonthKwh !== null && s?.pvPrevMonthKwh !== undefined && <div class="row"><span>минулого місяця</span><b>{fmtKwh(s.pvPrevMonthKwh)}</b></div>}
    {trees !== null && trees > 0 && <div class="row"><span>стільки поглинають за місяць</span><b>🌳 {trees} {trees === 1 ? "дерево" : trees < 5 ? "дерева" : "дерев"}</b></div>}
    {s?.pvTotalKwh !== null && s?.pvTotalKwh !== undefined && <div class="row"><span>всього від сонця</span><b>{fmtKwh(s.pvTotalKwh)}</b></div>}
  </div>;
}

/** Банер відключення: видно лише коли мережі немає (інакше тонкий рядок "мережа є"). */
export function OutageWidget({ cls, outage, since, hours, soc, props }: { cls: string; outage: boolean; since: number | null | undefined; hours: number | null; soc: number | null; props: Record<string, unknown> }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  if (!outage) return props.hideWhenOk === false
    ? <div class={`${cls} w-outage ok`}><div class="og-h">⚡ Світло є</div><div class="og-s">працюємо від мережі{soc !== null ? ` · батарея ${soc}%` : ""}</div></div>
    : <div class={`${cls} w-outage hidden`} />;
  const until = hours !== null ? new Date(Date.now() + hours * 3600_000) : null;
  return <div class={`${cls} w-outage on`}>
    <div class="og-h">🔋 Світла немає{since ? ` з ${hhmm(since)}` : ""}</div>
    <div class="og-s">працюємо від батареї{soc !== null ? ` · ${soc}%` : ""}{hours !== null ? ` · вистачить ≈ ${fmtHours(hours)}${until ? `, до ${hhmm(until.getTime())}` : ""}` : ""}</div>
    {props.note ? <div class="og-n">{String(props.note)}</div> : null}
  </div>;
}
