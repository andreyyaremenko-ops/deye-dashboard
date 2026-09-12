/** Оцінки для режиму відключення світла: чи є мережа, скільки годин лишилось на батареї. */

export type Metrics = Record<string, number | string | boolean | null | undefined>;
const num = (m: Metrics, k: string): number | null => (typeof m[k] === "number" ? (m[k] as number) : null);

/** Мережі немає: напруга на фазах нижче 100 В (або відсутня) і споживання не з мережі. */
export function gridDown(m: Metrics): boolean {
  const volts = ["grid_v_l1", "grid_v_l2", "grid_v_l3", "grid_v"].map((k) => num(m, k)).filter((v): v is number => v !== null);
  if (!volts.length) return false;
  return Math.max(...volts) < 100;
}

export interface RuntimeEstimate { hours: number; method: "capacity" | "slope" | "load" }

/**
 * Скільки годин протримається батарея при поточному споживанні.
 * capacityKwh відомий -> (soc - minSoc) * capacity / bat_w.
 * Інакше — за швидкістю падіння SOC (socHistory: [epochMs, soc], не менше 5 хв).
 * null, якщо батарея не розряджається або даних замало.
 */
export function estimateRuntime(m: Metrics, opts: { capacityKwh?: number | null; minSoc?: number; socHistory?: [number, number][]; assumeLoad?: boolean } = {}): RuntimeEstimate | null {
  const soc = num(m, "bat_soc"), batW = num(m, "bat_w"), loadW = num(m, "load_w");
  const minSoc = opts.minSoc ?? 20;
  if (soc === null) return null;
  const usablePct = Math.max(0, soc - minSoc);
  const cap = opts.capacityKwh && opts.capacityKwh > 0 ? opts.capacityKwh : null;
  if (cap && batW !== null && batW > 50) {
    return { hours: (usablePct / 100) * cap * 1000 / batW, method: "capacity" };
  }
  // мережа є: "якщо зараз зникне світло" — за поточним споживанням
  if (cap && opts.assumeLoad && loadW !== null && loadW > 50) {
    return { hours: (usablePct / 100) * cap * 1000 / loadW, method: "load" };
  }
  const h = opts.socHistory ?? [];
  if (h.length >= 2) {
    const [t0, s0] = h[0]!, [t1, s1] = h[h.length - 1]!;
    const dtH = (t1 - t0) / 3600_000;
    if (dtH >= 5 / 60 && s1 < s0) {
      const ratePctPerH = (s0 - s1) / dtH;
      return { hours: usablePct / ratePctPerH, method: "slope" };
    }
  }
  return null;
}

export function fmtHours(h: number): string {
  if (!Number.isFinite(h) || h < 0) return "—";
  if (h >= 48) return `${Math.round(h / 24)} дн`;
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return hh ? `${hh} год${mm ? ` ${mm} хв` : ""}` : `${mm} хв`;
}
