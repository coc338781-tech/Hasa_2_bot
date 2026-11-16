import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SESSION_BYTES = 32;
export const CUSTOMER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
export function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const phone = value.replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 12 || password.length > 128) throw new TypeError("password_policy");
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt.toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
}
export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string" || password.length > 128) return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(parts[2], "base64url");
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = Buffer.from(await scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}
export function createCustomerSessionToken() { return randomBytes(SESSION_BYTES).toString("base64url"); }
export function hashCustomerToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}
export function readCustomerBearer(req) {
  const match = /^Bearer ([A-Za-z0-9_-]{40,64})$/.exec(req.headers.authorization || "");
  return match ? match[1] : null;
}
