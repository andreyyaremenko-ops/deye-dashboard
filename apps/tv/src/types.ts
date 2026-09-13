import type { ScreenConfig, ScreenLocation } from "@deye/shared";
import type { AlertFeed, WeatherFeed } from "@deye/shared/feeds";

export interface Feeds { weather: WeatherFeed | null; alert: AlertFeed | null }

export interface DeviceState {
  deviceId: string;
  updatedAt: string;
  metrics: Record<string, number | string | boolean>;
  stale: boolean;
}
export interface PublicScreen {
  id: string;
  name: string;
  config: ScreenConfig;
  background: { files: Record<string, string> | null; preview: string | null } | null;
  deviceIds: string[];
  devices?: { id: string; batteryKwh: number | null; minSoc: number; pvKwp?: number | null }[];
  location?: ScreenLocation | null;
  branding: boolean;
  states: DeviceState[];
  feeds?: Feeds;
}
export type ConnStatus = "connecting" | "live" | "reconnecting" | "offline";
