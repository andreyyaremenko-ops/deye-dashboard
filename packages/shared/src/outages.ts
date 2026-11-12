/**
 * Графіки погодинних відключень (ГПВ) для віджета `outage_schedule`.
 *
 * Джерело — відкрите дзеркало сайтів ДТЕК github.com/Baskerville42/outage-data-ua (MIT, оновлюється
 * кожні ~5 хв): сайти ДТЕК закриті від ботів, а для Київської області іншого машиночитного джерела немає.
 * Сервер нормалізує його у OutageFeed (apps/api/src/feeds/outages.ts), екран рахує поточний стан сам.
 *
 * День — рядок із 48 символів, по одному на півгодини від півночі за Києвом:
 *   "0" — світло є, "1" — світла немає, "2" — можливе відключення.
 */
export const OUTAGE_REGIONS = [
  { id: "kyiv-region", label: "Київська область (ДТЕК КРЕМ)" },
  { id: "kyiv", label: "м. Київ (ДТЕК КЕМ / YASNO)" },
  { id: "dnipro", label: "Дніпропетровська область (ДТЕК ДнЕМ)" },
  { id: "odesa", label: "Одеська область (ДТЕК ОЕМ)" },
] as const;
export type OutageRegion = (typeof OUTAGE_REGIONS)[number]["id"];
export const isOutageRegion = (v: unknown): v is OutageRegion => OUTAGE_REGIONS.some((r) => r.id === v);

/** Черги з підчергами, як у ДТЕК: 1.1 … 6.2. */
export const OUTAGE_GROUPS: string[] = [1, 2, 3, 4, 5, 6].flatMap((q) => [`${q}.1`, `${q}.2`]);

export interface OutageDay {
  /** YYYY-MM-DD за Києвом */
  date: string;
  /** епоха (мс) київської півночі цього дня */
  start: number;
  /** черга -> 48 символів "0" | "1" | "2" */
  groups: Record<string, string>;
}

export interface OutageFeed {
  region: OutageRegion;
  /** коли ми востаннє отримали дані */
  fetchedAt: string;
  /** коли графік оновило джерело (ДТЕК), ISO; null — невідомо */
  sourceUpdatedAt: string | null;
  days: OutageDay[];
}

export type OutageState = "on" | "off" | "maybe";
const STATE: Record<string, OutageState> = { "0": "on", "1": "off", "2": "maybe" };
const SLOT_MS = 30 * 60_000;

export interface OutageStatus {
  state: OutageState;
  /** коли стан зміниться (епоха мс); null — до кінця відомого графіка без змін */
  nextAt: number | null;
  nextState: OutageState | null;
}

/** Поточний стан черги і найближча зміна за графіком; null — на цей момент графіка немає. */
export function outageStatus(feed: OutageFeed | null, group: string, now: number): OutageStatus | null {
  if (!feed) return null;
  const slots: { at: number; state: OutageState }[] = [];
  for (const d of [...feed.days].sort((a, b) => a.start - b.start)) {
    const s = d.groups[group];
    if (!s) continue;
    for (let i = 0; i < s.length; i++) slots.push({ at: d.start + i * SLOT_MS, state: STATE[s[i]!] ?? "on" });
  }
  const i = slots.findIndex((x) => now >= x.at && now < x.at + SLOT_MS);
  if (i < 0) return null;
  const state = slots[i]!.state;
  for (let j = i + 1; j < slots.length; j++) {
    // слоти мають іти підряд: діра між днями означає, що далі графіка ще немає
    if (slots[j]!.at !== slots[j - 1]!.at + SLOT_MS) break;
    if (slots[j]!.state !== state) return { state, nextAt: slots[j]!.at, nextState: slots[j]!.state };
  }
  return { state, nextAt: null, nextState: null };
}

/** День графіка, у який потрапляє момент (для смуги «сьогодні»). */
export function outageDayAt(feed: OutageFeed | null, now: number): OutageDay | null {
  return feed?.days.find((d) => now >= d.start && now < d.start + 48 * SLOT_MS) ?? null;
}
