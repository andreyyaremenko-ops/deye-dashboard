/**
 * Погода: Open-Meteo (без ключа). Одна точка на ~5 км (координати округлені до 0.05°),
 * тому 100 екранів в одному місті — один запит на пів години.
 */
import type { WeatherFeed } from "@deye/shared";

export const WEATHER_TTL_S = 2 * 3600;
export const WEATHER_REFRESH_MS = 30 * 60_000;

export function weatherKey(lat: number, lon: number): string {
  const r = (v: number) => (Math.round(v * 20) / 20).toFixed(2);
  return `${r(lat)},${r(lon)}`;
}

export function weatherUrl(lat: number, lon: number, base = "https://api.open-meteo.com"): string {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: "auto", forecast_days: "2",
    current: "temperature_2m,weather_code,wind_speed_10m,is_day",
    daily: "temperature_2m_max,temperature_2m_min,weather_code,shortwave_radiation_sum,sunrise,sunset",
  });
  return `${base}/v1/forecast?${q}`;
}

interface OpenMeteo {
  current: { temperature_2m: number; weather_code: number; wind_speed_10m: number; is_day: number };
  daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[]; shortwave_radiation_sum: number[]; sunrise: string[]; sunset: string[] };
}

export function parseWeather(json: unknown, now = new Date()): WeatherFeed {
  const d = json as OpenMeteo;
  if (!d?.current || !d?.daily?.time?.length) throw new Error("open-meteo: unexpected payload");
  return {
    updatedAt: now.toISOString(),
    current: { temp: d.current.temperature_2m, code: d.current.weather_code, windKmh: d.current.wind_speed_10m, isDay: d.current.is_day === 1 },
    daily: d.daily.time.map((date, i) => ({
      date, tmin: d.daily.temperature_2m_min[i]!, tmax: d.daily.temperature_2m_max[i]!, code: d.daily.weather_code[i]!,
      sunKwhM2: Math.round(((d.daily.shortwave_radiation_sum[i] ?? 0) / 3.6) * 100) / 100,   // MJ/m² -> kWh/m²
      sunrise: d.daily.sunrise[i]!, sunset: d.daily.sunset[i]!,
    })),
  };
}
