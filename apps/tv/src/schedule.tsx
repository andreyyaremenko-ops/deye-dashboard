/**
 * Віджет «Графік відключень» (outage_schedule): черга з налаштувань, графік регіону з нашого сервера
 * (/api/public/outages/<region>, той кешує дзеркало ДТЕК). Стан і час до наступної зміни рахуються тут,
 * щохвилини, без нових запитів; сам графік перечитується раз на 5 хв.
 * Час показуємо за Києвом: графік ДТЕК у київському часі, а годинник ТБ може стояти в іншому поясі.
 */
import { useEffect, useState } from "preact/hooks";
import { fmtHours } from "@deye/shared/energy";
import { isOutageRegion, outageDayAt, outageStatus, type OutageFeed, type OutageState } from "@deye/shared/outages";

const POLL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

function kyivHm(t: number): string {
  try { return new Date(t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Kyiv" }); }
  catch { return new Date(t).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }); }
}

const HEAD: Record<OutageState, string> = { on: "Світло є", off: "Світла немає", maybe: "Можливе відключення" };

export function ScheduleWidget({ cls, props }: { cls: string; props: Record<string, unknown> }) {
  const region = isOutageRegion(props.region) ? props.region : "kyiv-region";
  const group = String(props.group ?? "1.1");
  const plain = props.card === false;
  const [feed, setFeed] = useState<OutageFeed | null>(null);
  const [err, setErr] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`/api/public/outages/${region}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: OutageFeed) => { if (alive) { setFeed(j); setErr(false); } })
      .catch(() => { if (alive) setErr(true); });
    void load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [region]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const st = outageStatus(feed, group, now);
  const today = outageDayAt(feed, now);
  const tomorrow = outageDayAt(feed, (today?.start ?? now) + DAY_MS + 3_600_000);
  const hasToday = !!today?.groups[group];
  const noOutages = hasToday && !/[12]/.test(today!.groups[group]!) && !(tomorrow?.groups[group] && /[12]/.test(tomorrow.groups[group]!));

  let sub = "";
  if (st?.nextAt) {
    const left = (st.nextAt - now) / 3_600_000;
    const what = st.nextState === "on" ? "увімкнення" : st.nextState === "off" ? "відключення" : "можливе відключення";
    sub = `${what} о ${kyivHm(st.nextAt)} · через ${fmtHours(Math.max(left, 1 / 60))}`;
  } else if (st) sub = st.state === "on" ? "до кінця графіка без відключень" : "до кінця відомого графіка";

  return <div class={`${cls} w-sched${plain ? " sched-plain" : ""}${st ? ` s-${st.state}` : ""}`}>
    <div class="title"><span>{String(props.title ?? "") || "Графік відключень"}</span><span class="sched-q">черга {group}</span></div>
    {!feed
      ? <div class="sub">{err ? "графік недоступний" : "завантаження…"}</div>
      : !hasToday
        ? <div class="sub">для черги {group} графіка на сьогодні немає</div>
        : <>
          <div class="big sched-head">{noOutages ? "Відключень немає" : st ? HEAD[st.state] : "—"}</div>
          {!noOutages && sub && <div class="sub">{sub}</div>}
          <Bar label="сьогодні" s={today!.groups[group]!} start={today!.start} now={now} />
          {tomorrow?.groups[group] && <Bar label="завтра" s={tomorrow.groups[group]!} start={tomorrow.start} now={null} />}
          <div class="sched-foot">ДТЕК{feed.sourceUpdatedAt ? ` · оновлено ${kyivHm(Date.parse(feed.sourceUpdatedAt))}` : ""}</div>
        </>}
  </div>;
}

/** 48 півгодин: зелене — світло є, червоне — немає, жовте — можливо; риска — зараз. */
function Bar({ label, s, start, now }: { label: string; s: string; start: number; now: number | null }) {
  const pos = now === null ? null : Math.min(100, Math.max(0, ((now - start) / DAY_MS) * 100));
  return <div class="sched-row">
    <span class="sched-lbl">{label}</span>
    <div class="sched-track">
      <div class="sched-bar">{[...s].map((c, i) => <i key={i} class={c === "1" ? "off" : c === "2" ? "maybe" : "on"} />)}</div>
      {pos !== null && <div class="sched-now" style={{ left: `${pos}%` }} />}
      <div class="sched-hours">{[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}</span>)}</div>
    </div>
  </div>;
}
