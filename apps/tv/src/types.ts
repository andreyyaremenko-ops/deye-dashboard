import type { ScreenConfig } from "@deye/shared";

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
  devices?: { id: string; batteryKwh: number | null; minSoc: number }[];
  branding: boolean;
  states: DeviceState[];
}
export type ConnStatus = "connecting" | "live" | "reconnecting" | "offline";
