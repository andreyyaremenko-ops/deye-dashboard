/**
 * Зовнішні стрічки для екрана: погода (Open-Meteo) і повітряні тривоги.
 * Без zod, щоб ТБ-бандл міг імпортувати з "@deye/shared/feeds".
 */

export interface WeatherDay {
  date: string;            // YYYY-MM-DD
  tmin: number; tmax: number;
  code: number;            // WMO weather code
  /** сумарна сонячна радіація за день, kWh/m² (= "пікові сонячні години") */
  sunKwhM2: number;
  sunrise: string; sunset: string; // ISO local
}
export interface WeatherFeed {
  updatedAt: string;
  current: { temp: number; code: number; windKmh: number; isDay: boolean };
  daily: WeatherDay[];     // сьогодні, завтра
}

export interface AlertFeed {
  updatedAt: string;       // час останнього опитування джерела
  oblast: string;
  active: boolean;
  /** початок поточного стану, якщо джерело його знає */
  since: string | null;
}

/** Підпис і емодзі для WMO-коду погоди. */
export function wmoLabel(code: number, isDay = true): { text: string; icon: string } {
  if (code === 0) return { text: "ясно", icon: isDay ? "☀️" : "🌙" };
  if (code === 1) return { text: "переважно ясно", icon: isDay ? "🌤️" : "🌙" };
  if (code === 2) return { text: "мінлива хмарність", icon: "⛅" };
  if (code === 3) return { text: "хмарно", icon: "☁️" };
  if (code === 45 || code === 48) return { text: "туман", icon: "🌫️" };
  if (code >= 51 && code <= 57) return { text: "мряка", icon: "🌦️" };
  if (code >= 61 && code <= 67) return { text: "дощ", icon: "🌧️" };
  if (code >= 71 && code <= 77) return { text: "сніг", icon: "🌨️" };
  if (code >= 80 && code <= 82) return { text: "злива", icon: "🌧️" };
  if (code === 85 || code === 86) return { text: "снігопад", icon: "🌨️" };
  if (code >= 95) return { text: "гроза", icon: "⛈️" };
  return { text: "", icon: "🌡️" };
}

/**
 * Прогноз генерації за день: пікові сонячні години × потужність станції × коефіцієнт продуктивності.
 * PR 0.75 — типово для дахових систем (втрати на температуру, інвертор, кут).
 */
export function pvForecastKwh(sunKwhM2: number, kwp: number, pr = 0.75): number {
  return Math.max(0, sunKwhM2 * kwp * pr);
}

/** Рядок для QR "підключитись до Wi-Fi". Спецсимволи екрануються за специфікацією. */
export function wifiQr(ssid: string, password: string, auth: "WPA" | "WEP" | "nopass" = "WPA", hidden = false): string {
  const esc = (v: string) => v.replace(/([\;,":])/g, "\\$1");
  return `WIFI:T:${auth};S:${esc(ssid)};${auth === "nopass" ? "" : `P:${esc(password)};`}${hidden ? "H:true;" : ""};`;
}

/** Викиди CO₂ мережі України на 1 kWh (оцінка, кг). */
export const CO2_KG_PER_KWH = 0.45;

/** Області в тому вигляді, як їх називає джерело тривог. */
export const OBLASTS = [
  "м. Київ", "Київська область", "Вінницька область", "Волинська область", "Дніпропетровська область", "Донецька область",
  "Житомирська область", "Закарпатська область", "Запорізька область", "Івано-Франківська область", "Кіровоградська область",
  "Луганська область", "Львівська область", "Миколаївська область", "Одеська область", "Полтавська область", "Рівненська область",
  "Сумська область", "Тернопільська область", "Харківська область", "Херсонська область", "Хмельницька область", "Черкаська область",
  "Чернівецька область", "Чернігівська область", "Автономна Республіка Крим", "Севастополь",
  "м. Харків та Харківська територіальна громада", "м. Запоріжжя та Запорізька територіальна громада",
] as const;

/** Підбір області за admin1 геокодера ("Київська область", "Київ", "місто Київ"). */
export function guessOblast(admin1: string | null | undefined): string | null {
  if (!admin1) return null;
  const a = admin1.toLowerCase();
  if (/^(м\.\s*)?(місто\s+)?київ$/.test(a)) return "м. Київ";
  if (a.includes("севастополь")) return "Севастополь";
  const stem = a.replace(/\s*область.*$/, "").trim();
  return OBLASTS.find((o) => o.toLowerCase().startsWith(stem)) ?? null;
}
