import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://deye:deye@localhost:5432/deye"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  MQTT_URL: z.string().default("mqtt://localhost:1883"),
  MQTT_INTERNAL_USER: z.string().default("api"),
  MQTT_INTERNAL_PASS: z.string().default(""),
  API_PORT: z.coerce.number().default(3000),
  MEDIA_ROOT: z.string().default("/media"),
  LOGGER_PORT: z.coerce.number().default(10000),
  MONO_TOKEN: z.string().optional(),                       // токен monobank acquiring (тестовий з api.monobank.ua або бойовий)
  MONO_API: z.string().default("https://api.monobank.ua"),
  ALERTS_API_KEY: z.string().optional(),                   // api.ukrainealarm.com: офіційне джерело тривог
  ALERTS_API: z.string().default("https://api.ukrainealarm.com"),
  ALERTS_URL: z.string().default("https://ubilling.net.ua/aerialalerts/?json=true"), // "off" — вимкнути тривоги
  // ключі AI використовує воркер; API лише знає, які провайдери доступні (для вибору в кабінеті)
  XAI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  PUBLIC_URL: z.string().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().default("dev-secret-change-me-please-32-bytes"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("SunHunter TV <no-reply@sun-hunter.men>"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;
