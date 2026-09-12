/**
 * Карти регістрів Deye і парсер сирих регістрів у метрики.
 * Пристрій шле сирі регістри, уся інтерпретація тут (і в БД inverter_models).
 */
import deyeHp3 from "./maps/deye-hp3.json" with { type: "json" };

export interface RegisterField {
  key: string;
  reg: number;
  /** 1 = uint16/int16, 2 = uint32 (low word у reg, high у reg+1) */
  words?: 1 | 2;
  scale?: number;
  offset?: number;
  signed?: boolean;
  unit?: string;
  /** словник для enum-полів (state) */
  enum?: Record<string, string>;
}

export interface RegisterMap {
  id: string;
  name: string;
  deviceType: number;
  pollRanges: [number, number][];
  fields: RegisterField[];
  /** похідні метрики, обчислюються після основних */
  derived?: { key: string; sum?: string[]; unit?: string }[];
}

export type Metrics = Record<string, number | string>;

export const maps: Record<string, RegisterMap> = {
  [deyeHp3.id]: deyeHp3 as unknown as RegisterMap,
};

/** Вибір карти за reg 0 (тип пристрою). Повертає undefined, якщо не знаємо такий. */
export function mapForDeviceType(deviceType: number): RegisterMap | undefined {
  return Object.values(maps).find((m) => m.deviceType === deviceType);
}

/** hex-рядок з пристрою -> масив uint16 */
export function hexToRegs(hex: string): number[] {
  if (hex.length % 4 !== 0) throw new Error(`bad hex length ${hex.length}`);
  const out = new Array<number>(hex.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(4 * i, 4 * i + 4), 16);
  return out;
}

/** Діапазони з payload -> плоска таблиця reg -> uint16 */
export function rangesToTable(ranges: { start: number; regs: string | number[] }[]): Map<number, number> {
  const t = new Map<number, number>();
  for (const r of ranges) {
    const regs = typeof r.regs === "string" ? hexToRegs(r.regs) : r.regs;
    regs.forEach((v, i) => t.set(r.start + i, v));
  }
  return t;
}

export function decodeField(f: RegisterField, table: Map<number, number>): number | string | undefined {
  const lo = table.get(f.reg);
  if (lo === undefined) return undefined;
  let raw: number;
  if (f.words === 2) {
    const hi = table.get(f.reg + 1);
    if (hi === undefined) return undefined;
    raw = hi * 65536 + lo;
  } else {
    raw = f.signed && lo & 0x8000 ? lo - 0x10000 : lo;
  }
  if (f.enum) return f.enum[String(raw)] ?? `unknown(${raw})`;
  const v = raw * (f.scale ?? 1) + (f.offset ?? 0);
  return Math.round(v * 1000) / 1000;
}

export function decode(map: RegisterMap, table: Map<number, number>): Metrics {
  const out: Metrics = {};
  for (const f of map.fields) {
    const v = decodeField(f, table);
    if (v !== undefined) out[f.key] = v;
  }
  for (const d of map.derived ?? []) {
    if (d.sum) {
      const parts = d.sum.map((k) => out[k]).filter((v): v is number => typeof v === "number");
      if (parts.length === d.sum.length) out[d.key] = parts.reduce((a, b) => a + b, 0);
    }
  }
  return out;
}

/** Ідентифікація з діапазону 0..21: тип, серійник інвертора, номінал */
export function decodeIdentity(table: Map<number, number>) {
  const t = table.get(0);
  const sn = [3, 4, 5, 6, 7].map((r) => table.get(r));
  const serial = sn.every((v) => v !== undefined)
    ? sn.map((v) => String.fromCharCode(v! >> 8, v! & 0xff)).join("").replace(/\0/g, "")
    : undefined;
  const lo = table.get(20), hi = table.get(21);
  return {
    deviceType: t,
    inverterSerial: serial,
    ratedW: lo !== undefined && hi !== undefined ? (hi * 65536 + lo) / 10 : undefined,
  };
}
