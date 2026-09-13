import { describe, it, expect } from "vitest";
import { guessOblast, pvForecastKwh, wifiQr, wmoLabel } from "../src/feeds.ts";

describe("feeds helpers", () => {
  it("Wi-Fi QR за специфікацією, спецсимволи екрануються", () => {
    expect(wifiQr("Cafe", "pass123")).toBe("WIFI:T:WPA;S:Cafe;P:pass123;;");
    expect(wifiQr("My;Net", 'a:b"c', "WPA")).toBe('WIFI:T:WPA;S:My\\;Net;P:a\\:b\\"c;;');
    expect(wifiQr("Open", "", "nopass")).toBe("WIFI:T:nopass;S:Open;;");
  });
  it("область з admin1 геокодера", () => {
    expect(guessOblast("Київська область")).toBe("Київська область");
    expect(guessOblast("Київ")).toBe("м. Київ");
    expect(guessOblast("місто Київ")).toBe("м. Київ");
    expect(guessOblast("Львівська область")).toBe("Львівська область");
    expect(guessOblast("Автономна Республіка Крим")).toBeNull();
    expect(guessOblast(null)).toBeNull();
  });
  it("прогноз генерації і підписи погоди", () => {
    expect(pvForecastKwh(2.61, 15)).toBeCloseTo(29.4, 1);
    expect(wmoLabel(0).text).toBe("ясно"); expect(wmoLabel(0, false).icon).toBe("🌙");
    expect(wmoLabel(95).text).toBe("гроза");
  });
});
