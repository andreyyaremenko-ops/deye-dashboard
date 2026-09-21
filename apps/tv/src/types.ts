import type { MenuPayload, ScreenConfig, ScreenLocation } from "@deye/shared";
import type { AlertFeed, WeatherFeed } from "@deye/shared/feeds";

export interface Feeds { weather: WeatherFeed | null; alert: AlertFeed | null }

export interface DeviceState {
  deviceId: string;
  updatedAt: string;
  metrics: Record<string, number | string | boolean>;
  stale: boolean;
}
export type PublicMenu = MenuPayload;
export interface PublicBackground { kind?: "video" | "image"; files: Record<string, string> | null; preview: string | null }
export interface PublicScreen {
  id: string;
  name: string;
  config: ScreenConfig;
  background: PublicBackground | null;
  /** фони всіх сцен за id (API зі сценами); у старої відповіді немає */
  backgrounds?: Record<string, PublicBackground>;
  /** опубліковані меню віджетів за id (старі відповіді API їх не мають) */
  menus?: Record<string, PublicMenu>;
  deviceIds: string[];
  devices?: { id: string; batteryKwh: number | null; minSoc: number; pvKwp?: number | null }[];
  location?: ScreenLocation | null;
  branding: boolean;
  states: DeviceState[];
  feeds?: Feeds;
}
export type ConnStatus = "connecting" | "live" | "reconnecting" | "offline";
