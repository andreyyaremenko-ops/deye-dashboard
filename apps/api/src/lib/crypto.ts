import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

/** scrypt-хеш для секретів пристроїв: "s1$<salt>$<hash>" */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(secret, salt, 32)) as Buffer;
  return `s1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [v, saltB64, hashB64] = stored.split("$");
  if (v !== "s1" || !saltB64 || !hashB64) return false;
  const hash = (await scrypt(secret, Buffer.from(saltB64, "base64url"), 32)) as Buffer;
  const expected = Buffer.from(hashB64, "base64url");
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

/** Для claim-кодів і invite-токенів: детермінований sha256, щоб шукати за хешем. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 8 символів без 0/O/1/I для наліпки на корпусі */
const CLAIM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomClaimCode(): string {
  const b = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += CLAIM_ALPHABET[b[i]! % CLAIM_ALPHABET.length];
  return out;
}
export function normalizeClaimCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1");
}
