/**
 * Стрінги (входи MPPT) з телеметрії: pv1_w..pv4_w і пари pv<i>_v / pv<i>_a.
 * Скільки входів має інвертор — видно з карти моделі (HP3 до 4, LP 2), тому
 * беремо лише ті, що є в метриках.
 */
export interface PvString { i: number; w: number | null; v: number | null; a: number | null }

const num = (m: Record<string, unknown> | undefined, k: string): number | null =>
  (typeof m?.[k] === "number" ? (m[k] as number) : null);

/** Максимум входів у відомих картах Deye. */
export const MAX_PV_STRINGS = 4;

/**
 * Входи інвертора у порядку MPPT 1..N.
 * `used` — ті, що зараз дають струм або напругу; непідключені входи інвертор
 * віддає нулями, і показувати їх на екрані немає сенсу. Якщо нулі всі
 * (ніч, дощ), повертаємо всі наявні — інакше віджет був би порожній.
 */
export function pvStrings(m: Record<string, unknown> | undefined, max = MAX_PV_STRINGS): { all: PvString[]; used: PvString[] } {
  const all: PvString[] = [];
  for (let i = 1; i <= max; i++) {
    const w = num(m, `pv${i}_w`);
    if (w === null) continue;
    all.push({ i, w, v: num(m, `pv${i}_v`), a: num(m, `pv${i}_a`) });
  }
  const live = all.filter((s) => (s.w ?? 0) > 0 || (s.v ?? 0) > 0);
  return { all, used: live.length ? live : all };
}

/** Шкала смуг: найсильніший стрінг на всю ширину, але не менше minW, щоб слабкий лишався видимим. */
export function stringScaleW(rows: PvString[], minW = 100): number {
  return Math.max(minW, ...rows.map((s) => s.w ?? 0));
}
