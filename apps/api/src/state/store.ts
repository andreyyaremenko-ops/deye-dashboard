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

export interface Viewer { connId: string; ip: string; ua: string; since: string; lastSeen: string }
/** Глядач без heartbeat довше цього вважається відпалим (ping кожні 25 с). */
export const VIEWER_TTL_MS = 75_000;
const liveViewers = (list: Viewer[], now = Date.now()) => list.filter((v) => now - Date.parse(v.lastSeen) < VIEWER_TTL_MS);

export interface StateStore {
  set(s: DeviceStateSnapshot): Promise<void>;
  get(deviceId: string): Promise<DeviceStateSnapshot | null>;
  getMany(ids: string[]): Promise<DeviceStateSnapshot[]>;
  subscribe(handler: (s: DeviceStateSnapshot) => void): () => void;
  /** Екран змінено в кабінеті -> усі WS-клієнти цього екрана перечитують конфіг. */
  notifyScreen(screenId: string): Promise<void>;
  subscribeScreens(handler: (screenId: string) => void): () => void;
  /** Зовнішні стрічки (погода, тривоги): кеш із TTL + сповіщення про оновлення за ключем. */
  /** Телевізори, підключені до екрана по WS (для «показується / ні» в кабінеті й адмінці). */
  touchViewer(screenId: string, v: Viewer): Promise<void>;
  removeViewer(screenId: string, connId: string): Promise<void>;
  viewers(screenId: string): Promise<Viewer[]>;
  viewerCounts(screenIds: string[]): Promise<Record<string, number>>;
  setFeed(key: string, value: unknown, ttlS: number): Promise<void>;
  getFeed<T = unknown>(key: string): Promise<T | null>;
  notifyFeed(key: string): Promise<void>;
  subscribeFeeds(handler: (key: string) => void): () => void;
  close(): Promise<void>;
}

export class MemoryStateStore implements StateStore {
  private map = new Map<string, DeviceStateSnapshot>();
  private ee = new EventEmitter();
  async set(s: DeviceStateSnapshot) { this.map.set(s.deviceId, s); this.ee.emit("state", s); }
  async get(id: string) { return this.map.get(id) ?? null; }
  async getMany(ids: string[]) { return ids.map((i) => this.map.get(i)).filter((x): x is DeviceStateSnapshot => !!x); }
  subscribe(h: (s: DeviceStateSnapshot) => void) { this.ee.on("state", h); return () => this.ee.off("state", h); }
  notified: string[] = [];
  async notifyScreen(id: string) { this.notified.push(id); this.ee.emit("screen", id); }
  subscribeScreens(h: (id: string) => void) { this.ee.on("screen", h); return () => this.ee.off("screen", h); }
  viewerMap = new Map<string, Map<string, Viewer>>();
  async touchViewer(id: string, v: Viewer) { const m = this.viewerMap.get(id) ?? new Map(); m.set(v.connId, v); this.viewerMap.set(id, m); }
  async removeViewer(id: string, connId: string) { this.viewerMap.get(id)?.delete(connId); }
  async viewers(id: string) { return liveViewers([...(this.viewerMap.get(id)?.values() ?? [])]); }
  async viewerCounts(ids: string[]) { const out: Record<string, number> = {}; for (const id of ids) out[id] = (await this.viewers(id)).length; return out; }
  feeds = new Map<string, { value: unknown; exp: number }>();
  async setFeed(key: string, value: unknown, ttlS: number) { this.feeds.set(key, { value, exp: Date.now() + ttlS * 1000 }); }
  async getFeed<T>(key: string) { const f = this.feeds.get(key); return f && f.exp > Date.now() ? (f.value as T) : null; }
  async notifyFeed(key: string) { this.ee.emit("feed", key); }
  subscribeFeeds(h: (key: string) => void) { this.ee.on("feed", h); return () => this.ee.off("feed", h); }
  async close() {}
}

const CHANNEL = "device_state";
const SCREEN_CHANNEL = "screen_update";
const FEED_CHANNEL = "feed_update";

export class RedisStateStore implements StateStore {
  private pub: Redis;
  private sub: Redis;
  private ee = new EventEmitter();
  constructor(url: string) {
    this.pub = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
    this.sub = new Redis(url);
    this.sub.subscribe(CHANNEL, SCREEN_CHANNEL, FEED_CHANNEL);
    this.sub.on("message", (ch: string, msg: string) => {
      if (ch === SCREEN_CHANNEL) { this.ee.emit("screen", msg); return; }
      if (ch === FEED_CHANNEL) { this.ee.emit("feed", msg); return; }
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
  async notifyScreen(id: string) { await this.pub.publish(SCREEN_CHANNEL, id); }
  subscribeScreens(h: (id: string) => void) { this.ee.on("screen", h); return () => this.ee.off("screen", h); }
  // hash на екран: connId -> JSON; відпалі поля чистяться при читанні, ключ живе годину після останнього touch
  async touchViewer(id: string, v: Viewer) { await this.pub.multi().hset(`viewers:${id}`, v.connId, JSON.stringify(v)).expire(`viewers:${id}`, 3600).exec(); }
  async removeViewer(id: string, connId: string) { await this.pub.hdel(`viewers:${id}`, connId); }
  async viewers(id: string) {
    const all = await this.pub.hgetall(`viewers:${id}`);
    const parsed = Object.values(all).map((s) => JSON.parse(s) as Viewer);
    const live = liveViewers(parsed);
    const dead = parsed.filter((v) => !live.includes(v)).map((v) => v.connId);
    if (dead.length) await this.pub.hdel(`viewers:${id}`, ...dead);
    return live;
  }
  async viewerCounts(ids: string[]) { const out: Record<string, number> = {}; for (const id of ids) out[id] = (await this.viewers(id)).length; return out; }
  async setFeed(key: string, value: unknown, ttlS: number) { await this.pub.set(`feed:${key}`, JSON.stringify(value), "EX", ttlS); }
  async getFeed<T>(key: string) { const v = await this.pub.get(`feed:${key}`); return v ? (JSON.parse(v) as T) : null; }
  async notifyFeed(key: string) { await this.pub.publish(FEED_CHANNEL, key); }
  subscribeFeeds(h: (key: string) => void) { this.ee.on("feed", h); return () => this.ee.off("feed", h); }
  async close() { await this.pub.quit(); await this.sub.quit(); }
}

/** Скільки секунд без даних вважаємо стан застарілим (екран показує явно). */
export const STALE_AFTER_S = 60;
export function isStale(s: DeviceStateSnapshot, now = Date.now()): boolean {
  return now - Date.parse(s.updatedAt) > STALE_AFTER_S * 1000;
}
