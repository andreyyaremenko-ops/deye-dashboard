/**
 * Генерація по стрінгах (MPPT): скільки дає кожен вхід панелей окремо.
 * Вибір входів і шкала смуг — у @deye/shared/strings (там же тести).
 */
import { pvStrings, stringScaleW } from "@deye/shared/strings";
import { fmtW } from "./widgets.tsx";

type M = Record<string, number | string | boolean>;

interface Props { cls: string; state: M | undefined; props: Record<string, unknown>; stale: boolean; night: boolean }

export function MpptWidget({ cls, state: m, props, stale, night }: Props) {
  const { used } = pvStrings(m);
  const names = Array.isArray(props.names) ? (props.names as unknown[]).map((n) => String(n)) : [];
  const showVA = props.showVA !== false;
  const total = used.reduce((s, r) => s + (r.w ?? 0), 0);
  const scale = stringScaleW(used);

  return <div class={`${cls} mppt${props.card === false ? " mppt-plain" : ""}`}>
    <div class="title">
      {String(props.title ?? "Стрінги")}
      {used.length > 0 && !night && <span class="mppt-total">{fmtW(total)}</span>}
      {stale && <span class="badge">дані застарілі</span>}
    </div>
    {used.length === 0
      ? <div class="sub">немає даних по входах панелей</div>
      : night
        ? <div class="big">ніч</div>
        : <div class="mppt-rows">{used.map((r) => {
          const w = r.w ?? 0;
          const va = `${r.v !== null ? `${Math.round(r.v)} V` : ""}${r.v !== null && r.a !== null ? " · " : ""}${r.a !== null ? `${r.a.toFixed(1)} A` : ""}`;
          return <div key={r.i} class={`mppt-row${w <= 0 ? " off" : ""}`}>
            <span class="mppt-head">
              <span class="mppt-name">{names[r.i - 1]?.trim() || `MPPT ${r.i}`}</span>
              <b class="mppt-w">{fmtW(w)}</b>
            </span>
            <span class="mppt-right">
              <span class="mppt-bar"><span class="mppt-fill" style={{ width: `${Math.round((w / scale) * 100)}%` }} /></span>
              {showVA && va && <span class="mppt-va">{va}</span>}
            </span>
          </div>;
        })}</div>}
  </div>;
}
