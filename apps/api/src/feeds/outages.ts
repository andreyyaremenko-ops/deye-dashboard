/**
 * Графіки погодинних відключень з github.com/Baskerville42/outage-data-ua (MIT): дзеркало сайтів ДТЕК,
 * які закриті від ботів. Формат файлу — той самий, що в DisconSchedule на сайтах ДТЕК:
 *   fact.data[<епоха київської півночі, с>]["GPV3.2"][<година 1..24>] = "yes" | "no" | "first" | "second" | "maybe" | …
 *   fact.update = "12.11.2026 20:47" (київський час)
 * Нормалізуємо в OutageFeed (packages/shared/src/outages.ts): по 48 півгодинних символів на чергу.
 */
import type { OutageDay, OutageFeed, OutageRegion } from "@deye/shared/outages";

export const OUTAGES_BASE = "https://raw.githubusercontent.com/Baskerville42/outage-data-ua/main/data";
export const outagesUrl = (region: OutageRegion, base = OUTAGES_BASE) => `${base}/${region}.json`;
/** Джерело оновлюється кожні ~5 хв; частіше ходити немає сенсу. */
export const OUTAGES_REFRESH_MS = 5 * 60_000;
/** Кеш живе довше за інтервал: якщо GitHub недоступний, екран показує останній відомий графік. */
export const OUTAGES_TTL_S = 6 * 3600;

/** Година ДТЕК -> дві половини: "0" світло є, "1" немає, "2" можливо. */
const HALVES: Record<string, string> = {
  yes: "00", no: "11", first: "10", second: "01", maybe: "22", mfirst: "20", msecond: "02",
};

const kyivDate = (epochMs: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(epochMs));

/** Київський настінний час -> епоха мс (зсув беремо в Intl, щоб літній/зимовий час рахувався сам). */
export function kyivToEpoch(y: number, mo: number, d: number, h: number, mi: number): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return asUtc - (shown - asUtc);
}

function parseUpdate(s: unknown): string | null {
  const m = typeof s === "string" ? /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/.exec(s.trim()) : null;
  if (!m) return null;
  return new Date(kyivToEpoch(+m[3]!, +m[2]!, +m[1]!, +m[4]!, +m[5]!)).toISOString();
}

interface Raw { regionId?: string; fact?: { data?: Record<string, Record<string, Record<string, string>>>; update?: string } }

export function parseOutages(json: unknown, region: OutageRegion, now = new Date()): OutageFeed {
  const raw = json as Raw;
  const data = raw?.fact?.data;
  if (!data || typeof data !== "object") throw new Error("outage-data-ua: no fact.data");
  const days: OutageDay[] = [];
  for (const [key, groups] of Object.entries(data)) {
    const start = Number(key) * 1000;
    if (!Number.isFinite(start) || !groups || typeof groups !== "object") continue;
    const out: Record<string, string> = {};
    for (const [gpv, hours] of Object.entries(groups)) {
      const g = /^GPV(\d\.\d)$/.exec(gpv)?.[1];
      if (!g || !hours || typeof hours !== "object") continue;
      let s = "";
      for (let h = 1; h <= 24; h++) s += HALVES[String(hours[String(h)])] ?? "00";
      out[g] = s;
    }
    if (Object.keys(out).length) days.push({ date: kyivDate(start), start, groups: out });
  }
  if (!days.length) throw new Error("outage-data-ua: empty schedule");
  days.sort((a, b) => a.start - b.start);
  return { region, fetchedAt: now.toISOString(), sourceUpdatedAt: parseUpdate(raw.fact?.update), days };
}
