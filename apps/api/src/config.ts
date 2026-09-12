import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().default("postgres://deye:deye@localhost:5432/deye"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  MQTT_URL: z.string().default("mqtt://localhost:1883"),
  MQTT_INTERNAL_USER: z.string().default("api"),
  MQTT_INTERNAL_PASS: z.string().default(""),
  API_PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().default("dev-secret-change-me-please-32-bytes"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const config = schema.parse(process.env);
export type Config = typeof config;
