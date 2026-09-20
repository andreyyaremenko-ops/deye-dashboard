/**
 * Карти регістрів Deye і парсер сирих регістрів у метрики.
 * Пристрій шле сирі регістри, уся інтерпретація тут (і в БД inverter_models).
 */
import deyeHp3 from "./maps/deye-hp3.json" with { type: "json" };
import deyeHp3P105 from "./maps/deye-hp3-p105.json" with { type: "json" };
import deyeLp1 from "./maps/deye-lp1.json" with { type: "json" };
import deyeLp3 from "./maps/deye-lp3.json" with { type: "json" };

export interface RegisterField {
  key: string;
  reg: number;
  /** 1 = uint16/int16, 2 = uint32 (low word у reg, high у reg+1 або у hiReg) */
  words?: 1 | 2;
  /** регістр high word, якщо не reg+1 (LP1: total bought = 78 + 80, бо 79 — частота) */
  hiReg?: number;
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
  /** варіант прошивки: береться, якщо протокол пристрою (регістр 2) не менший */
  protocolMin?: number;
}

/** Варіант карти: та сама база, але частина полів перевизначена (інша прошивка). */
interface RegisterMapVariant {
  id: string;
  name: string;
  deviceType: number;
  protocolMin: number;
  extends: string;
  overrides: (Partial<RegisterField> & { key: string })[];
}

function buildVariant(v: RegisterMapVariant, base: RegisterMap): RegisterMap {
  const byKey = new Map(v.overrides.map((o) => [o.key, o]));
  for (const key of byKey.keys()) {
    if (!base.fields.some((f) => f.key === key)) throw new Error(`${v.id}: немає поля ${key} у ${base.id}`);
  }
  return {
    ...base,
    id: v.id,
    name: v.name,
    deviceType: v.deviceType,
    protocolMin: v.protocolMin,
    fields: base.fields.map((f) => (byKey.has(f.key) ? { ...f, ...byKey.get(f.key)! } : f)),
  };
}

export type Metrics = Record<string, number | string>;

export const maps: Record<string, RegisterMap> = {
  [deyeHp3.id]: deyeHp3 as unknown as RegisterMap,
  [deyeLp1.id]: deyeLp1 as unknown as RegisterMap,
  [deyeLp3.id]: deyeLp3 as unknown as RegisterMap,
};
maps[deyeHp3P105.id] = buildVariant(deyeHp3P105 as unknown as RegisterMapVariant, maps[deyeHp3.id]!);

/**
 * Вибір карти за reg 0 (тип пристрою) і, якщо відомий, протоколом з reg 2:
 * серед карт одного типу перемагає найспецифічніший варіант прошивки.
 * Повертає undefined, якщо не знаємо такий тип.
 */
export function mapForDeviceType(deviceType: number, protocol?: number): RegisterMap | undefined {
  const same = Object.values(maps).filter((m) => m.deviceType === deviceType);
  const variant = protocol === undefined ? undefined
    : same.filter((m) => m.protocolMin !== undefined && protocol >= m.protocolMin)
          .sort((a, b) => b.protocolMin! - a.protocolMin!)[0];
  return variant ?? same.find((m) => m.protocolMin === undefined);
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
    const hi = table.get(f.hiReg ?? f.reg + 1);
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
      if (parts.length === d.sum.length) out[d.key] = Math.round(parts.reduce((a, b) => a + b, 0) * 1000) / 1000;
    }
  }
  return out;
}

/** Ідентифікація з діапазону 0..21: тип, протокол, серійник інвертора, номінал */
export function decodeIdentity(table: Map<number, number>) {
  const t = table.get(0);
  const protocol = table.get(2);
  const sn = [3, 4, 5, 6, 7].map((r) => table.get(r));
  const serial = sn.every((v) => v !== undefined)
    ? sn.map((v) => String.fromCharCode(v! >> 8, v! & 0xff)).join("").replace(/\0/g, "")
    : undefined;
  const lo = table.get(20), hi = table.get(21);
  return {
    deviceType: t,
    protocol,
    inverterSerial: serial,
    ratedW: lo !== undefined && hi !== undefined ? (hi * 65536 + lo) / 10 : undefined,
  };
}
