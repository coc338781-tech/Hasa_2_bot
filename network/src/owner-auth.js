import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 30 * 60 * 1000;
const b64 = value => Buffer.from(value).toString("base64url");

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest();
}

export function createOwnerSession(accessKey, configuredKey, now = Date.now()) {
  if (typeof configuredKey !== "string" || configuredKey.length < 32) return null;
  if (typeof accessKey !== "string" || accessKey.length < 32) return null;
  const supplied = Buffer.from(signature(accessKey, "hasa-owner-key-check"));
  const expected = Buffer.from(signature(configuredKey, "hasa-owner-key-check"));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  const payload = b64(JSON.stringify({ exp: now + SESSION_TTL_MS, nonce: randomBytes(16).toString("base64url") }));
  return `${payload}.${signature(payload, configuredKey).toString("base64url")}`;
}

export function verifyOwnerSession(token, configuredKey, now = Date.now()) {
  if (typeof configuredKey !== "string" || configuredKey.length < 32 || typeof token !== "string" || token.length > 1024) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expected = signature(parts[0], configuredKey);
  let actual;
  try { actual = Buffer.from(parts[1], "base64url"); } catch { return false; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return Number.isSafeInteger(payload.exp) && payload.exp > now && payload.exp <= now + SESSION_TTL_MS + 5000 &&
      typeof payload.nonce === "string" && payload.nonce.length >= 20;
  } catch { return false; }
}

export function createEnrollmentTicketValue() {
  return randomBytes(32).toString("base64url");
}

export const OWNER_SESSION_TTL_MS = SESSION_TTL_MS;
