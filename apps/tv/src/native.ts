/**
 * Міст Android-застосунку (apps/android, Bridge.kt): там радіо грає нативний плеєр поза WebView,
 * тож відеофон і звук не ділять один медіаелемент. У звичайному браузері моста немає.
 */
export interface NativeTv {
  version(): string;
  radioPlay(url: string, volume: number): void;
  radioVolume(volume: number): void;
  radioStop(): void;
}

export function nativeTv(): NativeTv | null {
  return (window as unknown as { SunHunterTv?: NativeTv }).SunHunterTv ?? null;
}
