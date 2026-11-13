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

/** Ім'я фрейму, у якому сторінку відкриває застосунок Samsung (apps/tizen/src/main.js); window.name переживає
 *  перехід /tv -> /s/<token>. */
export const TIZEN_FRAME = "sunhunter-tizen";

/** Застосунок Samsung: сторінка у фреймі, радіо грає AVPlay у батьківському вікні (команди через postMessage).
 *  На Tizen 2.4 <video> і <audio> разом не грають, а <video> і AVPlay — так. */
function tizenBridge(): NativeTv | null {
  if (window.name !== TIZEN_FRAME || window.parent === window) return null;
  const post = (msg: object) => window.parent.postMessage({ sunhunter: 1, ...msg }, "*");   // батько — file://, origin "null"
  return {
    version: () => "tizen",
    radioPlay: (url, volume) => post({ cmd: "radioPlay", url, volume }),
    radioVolume: (volume) => post({ cmd: "radioVolume", volume }),
    radioStop: () => post({ cmd: "radioStop" }),
  };
}

export function nativeTv(): NativeTv | null {
  return (window as unknown as { SunHunterTv?: NativeTv }).SunHunterTv ?? tizenBridge();
}
