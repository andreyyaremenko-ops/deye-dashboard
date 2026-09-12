/**
 * Останній стан пристроїв + pub/sub для WebSocket.
 * Redis у проді; MemoryStateStore для тестів і локального запуску без Redis.
 */
import { EventEmitter } from "node:events";
import { Redis } from "ioredis";

export interface DeviceStateSnapshot {
  deviceId: string;
  updatedAt: string;               // ISO
  metrics: Record<string, number | string | boolean>;
}

export interface StateStore {
  set(s: DeviceStateSnapshot): Promise<void>;
  get(deviceId: string): Promise<DeviceStateSnapshot | null>;
  getMany(ids: string[]): Promise<DeviceStateSnapshot[]>;
  subscribe(handler: (s: DeviceStateSnapshot) => void): () => void;
  close(): Promise<void>;
}

export class MemoryStateStore implements StateStore {
  private map = new Map<string, DeviceStateSnapshot>();
  private ee = new EventEmitter();
  async set(s: DeviceStateSnapshot) { this.map.set(s.deviceId, s); this.ee.emit("state", s); }
  async get(id: string) { return this.map.get(id) ?? null; }
  async getMany(ids: string[]) { return ids.map((i) => this.map.get(i)).filter((x): x is DeviceStateSnapshot => !!x); }
  subscribe(h: (s: DeviceStateSnapshot) => void) { this.ee.on("state", h); return () => this.ee.off("state", h); }
  async close() {}
}

const CHANNEL = "device_state";

export class RedisStateStore implements StateStore {
  private pub: Redis;
  private sub: Redis;
  private ee = new EventEmitter();
  constructor(url: string) {
    this.pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
    this.sub = new Redis(url);
    this.sub.subscribe(CHANNEL);
    this.sub.on("message", (_ch: string, msg: string) => {
      try { this.ee.emit("state", JSON.parse(msg)); } catch { /* ignore */ }
    });
  }
  async set(s: DeviceStateSnapshot) {
    const json = JSON.stringify(s);
    await this.pub.multi().set(`state:${s.deviceId}`, json, "EX", 86400).publish(CHANNEL, json).exec();
  }
  async get(id: string) {
    const v = await this.pub.get(`state:${id}`);
    return v ? (JSON.parse(v) as DeviceStateSnapshot) : null;
  }
  async getMany(ids: string[]) {
    if (!ids.length) return [];
    const vals = await this.pub.mget(ids.map((i) => `state:${i}`));
    return vals.filter((v): v is string => !!v).map((v) => JSON.parse(v) as DeviceStateSnapshot);
  }
  subscribe(h: (s: DeviceStateSnapshot) => void) { this.ee.on("state", h); return () => this.ee.off("state", h); }
  async close() { await this.pub.quit(); await this.sub.quit(); }
}

/** Скільки секунд без даних вважаємо стан застарілим (екран показує явно). */
export const STALE_AFTER_S = 60;
export function isStale(s: DeviceStateSnapshot, now = Date.now()): boolean {
  return now - Date.parse(s.updatedAt) > STALE_AFTER_S * 1000;
}
