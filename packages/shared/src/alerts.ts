/**
 * Звукові сповіщення екрана: зникла / відновилась мережа, критичний заряд батареї, дуже потужна генерація.
 *
 * Події визначає сам ТБ за потоком станів пристрою — сервер нічого не рахує. Тому все тут —
 * чиста функція над памʼяттю попереднього стану: перший замір лише запамʼятовується (екран, що
 * перезавантажився посеред відключення, не має кричати «зникла мережа»), мережа перемикається
 * лише після двох однакових замірів поспіль (одиночний провал напруги — не подія), а пороги мають
 * гістерезис, щоб заряд, що коливається біля межі, не пищав щохвилини.
 */
import { gridDown, type Metrics } from "./energy.ts";

export type AlertKind = "grid_down" | "grid_up" | "soc_low" | "pv_high";

/** Пороги з налаштувань пристрою в кабінеті; null — подія вимкнена. */
export interface AlertThresholds {
  /** критичний заряд, %: сповіщення, коли SOC опускається до цього значення */
  alertSoc: number | null;
  /** «скажена генерація»: % від номіналу поля панелей (pvKwp) */
  alertPvPct: number | null;
  /** номінал поля панелей, кВт — без нього відсоток не має сенсу */
  pvKwp: number | null;
}

export interface AlertMemory {
  /** підтверджений стан мережі: null — ще не знаємо (перший замір) */
  gridDown: boolean | null;
  /** скільки замірів поспіль мережа в стані, протилежному підтвердженому */
  flips: number;
  socLow: boolean | null;
  pvHigh: boolean | null;
  /** коли востаннє сповіщали про генерацію (вона може триматись годинами біля порогу) */
  pvAlertAt: number;
}

export interface AlertEvent { kind: AlertKind; text: string }

export const newAlertMemory = (): AlertMemory => ({ gridDown: null, flips: 0, socLow: null, pvHigh: null, pvAlertAt: 0 });

/** Скільки замірів поспіль має триматись новий стан мережі (заміри приходять раз на 10–30 с). */
export const GRID_CONFIRM = 2;
/** Гістерезис порогів, відсоткові пункти. */
export const SOC_HYST = 3;
export const PV_HYST = 5;
/** Не частіше одного сповіщення про генерацію на годину. */
export const PV_REPEAT_MS = 60 * 60_000;

const num = (m: Metrics, k: string): number | null => (typeof m[k] === "number" && Number.isFinite(m[k]) ? (m[k] as number) : null);
const fmtKw = (w: number) => `${(w / 1000).toFixed(w >= 10_000 ? 0 : 1)} кВт`;

/** Події, що сталися з цим заміром; mem змінюється на місці. */
export function detectAlerts(mem: AlertMemory, m: Metrics, t: AlertThresholds, now: number): AlertEvent[] {
  const out: AlertEvent[] = [];

  // мережа: є хоч одна напруга — інакше пристрій її просто не міряє, і подій не буде
  const hasGridV = ["grid_v_l1", "grid_v_l2", "grid_v_l3", "grid_v"].some((k) => num(m, k) !== null);
  if (hasGridV) {
    const down = gridDown(m);
    if (mem.gridDown === null) { mem.gridDown = down; mem.flips = 0; }
    else if (down !== mem.gridDown) {
      if (++mem.flips >= GRID_CONFIRM) {
        mem.gridDown = down; mem.flips = 0;
        out.push(down ? { kind: "grid_down", text: "Зникла мережа" } : { kind: "grid_up", text: "Мережу відновлено" });
      }
    } else mem.flips = 0;
  }

  const soc = num(m, "bat_soc");
  if (t.alertSoc !== null && soc !== null) {
    const low = mem.socLow ? soc < t.alertSoc + SOC_HYST : soc <= t.alertSoc;
    if (mem.socLow === false && low) out.push({ kind: "soc_low", text: `Критичний заряд батареї: ${Math.round(soc)} %` });
    mem.socLow = low;
  } else mem.socLow = null;

  const pv = num(m, "pv_w");
  if (t.alertPvPct !== null && t.pvKwp && pv !== null) {
    const nominal = t.pvKwp * 1000;
    const pct = (pv / nominal) * 100;
    const high = mem.pvHigh ? pct > t.alertPvPct - PV_HYST : pct >= t.alertPvPct;
    if (mem.pvHigh === false && high && now - mem.pvAlertAt >= PV_REPEAT_MS) {
      mem.pvAlertAt = now;
      out.push({ kind: "pv_high", text: `Потужна генерація: ${fmtKw(pv)}, ${Math.round(pct)} % від номіналу` });
    }
    mem.pvHigh = high;
  } else mem.pvHigh = null;

  return out;
}
