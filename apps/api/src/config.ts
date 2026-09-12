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
  PUBLIC_URL: z.string().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().default("dev-secret-change-me-please-32-bytes"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("Deye Dashboard <no-reply@sun-hunter.men>"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;
