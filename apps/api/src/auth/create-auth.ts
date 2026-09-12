import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { config } from "../config.ts";
import type { Mailer } from "../mail/index.ts";
import * as authSchema from "../db/auth-schema.ts";

export function createAuth(db: PgDatabase<any, any, any>, mailer: Mailer) {
  return betterAuth({
    baseURL: config.PUBLIC_URL,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.PUBLIC_URL],
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    emailAndPassword: { enabled: true },
    socialProviders: config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET } }
      : {},
    user: {
      additionalFields: {
        isSuperadmin: { type: "boolean", defaultValue: false, input: false, fieldName: "is_superadmin" },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          await mailer({
            to: email,
            subject: "Вхід у Deye Dashboard",
            text: `Посилання для входу (діє 15 хвилин): ${url}`,
            html: `<p>Посилання для входу (діє 15 хвилин):</p><p><a href="${url}">${url}</a></p>`,
          });
        },
      }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
