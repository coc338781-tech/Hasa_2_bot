import http from "node:http";
import { pathToFileURL } from "node:url";
import { acceptHeartbeat } from "./heartbeat.js";
import { exchangeEnrollmentTicket, hashSecret } from "./enrollment.js";
import { createOwnerSession, verifyOwnerSession, createEnrollmentTicketValue } from "./owner-auth.js";
import { randomUUID } from "node:crypto";

const VERSION = "0.2.0";
const MAX_BODY_BYTES = 16 * 1024;
const enrollmentAttempts = new Map();
const ownerLoginAttempts = new Map();
function rateLimited(map, key, now, limit) {
  const entry = map.get(key) || { start: now, count: 0 };
  if (now - entry.start >= 60_000) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  map.set(key, entry);
  if (map.size > 5000) map.clear();
  return entry.count > limit;
}
function enrollmentRateLimited(key, now) {
  return rateLimited(enrollmentAttempts, key, now, 5);
}
function ownerLoginRateLimited(key, now) {
  return rateLimited(ownerLoginAttempts, key, now, 5);
}
function ownerAuthorized(req, configuredKey, now) {
  const match = /^Bearer ([A-Za-z0-9_.-]{40,1024})$/.exec(req.headers.authorization || "");
  return Boolean(match && verifyOwnerSession(match[1], configuredKey, now));
}
function cleanLabel(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80 ? value.trim() : null;
}
function cleanProvider(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 60 ? value.trim() : null;
}

  const entry = enrollmentAttempts.get(key) || { start: now, count: 0 };
  if (now - entry.start >= 60_000) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  enrollmentAttempts.set(key, entry);
  if (enrollmentAttempts.size > 5000) enrollmentAttempts.clear();
  return entry.count > 5;
}

function sendJson(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(encoded) });
  res.end(encoded);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("payload_too_large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

export function createAppServer({ agentStore = null, clock = () => Date.now() } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");

    if (req.method === "GET" && req.url === "/healthz") {
      sendJson(res, 200, { service: "hasa-bot-network-api", status: "ok", version: VERSION, timestamp: new Date(clock()).toISOString() });
      return;
    }
    if (req.method === "POST" && req.url === "/v1/owner/login") {
      const remote = req.socket.remoteAddress || "unknown";
      if (ownerLoginRateLimited(remote, clock())) {
        sendJson(res, 429, { error: "rate_limited" });
        return;
      }
      try {
        const body = await readJson(req);
        const session = createOwnerSession(body?.access_key, process.env.HASA_OWNER_ACCESS_KEY, clock());
        if (!session) { sendJson(res, 401, { error: "invalid_owner_credentials" }); return; }
        sendJson(res, 200, { authenticated: true, access_token: session, expires_in_seconds: 1800 });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/v1/owner/server-enrollment-tickets") {
      if (!ownerAuthorized(req, process.env.HASA_OWNER_ACCESS_KEY, clock())) {
        sendJson(res, 401, { error: "owner_authentication_required" });
        return;
      }
      try {
        const body = await readJson(req);
        const label = cleanLabel(body?.label);
        const provider = cleanProvider(body?.provider);
        if (!label || !provider) { sendJson(res, 400, { error: "invalid_server_details" }); return; }
        if (!agentStore || typeof agentStore.createEnrollmentTicket !== "function") {
          sendJson(res, 503, { error: "enrollment_storage_unavailable" });
          return;
        }
        const ticket = createEnrollmentTicketValue();
        const expiresAt = new Date(clock() + 10 * 60 * 1000).toISOString();
        await agentStore.createEnrollmentTicket({
          id: randomUUID(), ticketHash: hashSecret(ticket), label, provider, expiresAt
        });
        sendJson(res, 201, { ticket, label, provider, expires_at: expiresAt, uses: 1 });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/v1/agent/enroll") {
      const remote = req.socket.remoteAddress || "unknown";
      if (enrollmentRateLimited(remote, clock())) {
        sendJson(res, 429, { error: "rate_limited" });
        return;
      }
      try {
        const body = await readJson(req);
        const result = await exchangeEnrollmentTicket({ ticket: body?.ticket, store: agentStore, now: clock() });
        sendJson(res, result.status, result.body || { error: result.error });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/v1/agent/heartbeat") {
      const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || "");
      if (!match) { sendJson(res, 401, { error: "unauthorized" }); return; }
      try {
        const payload = await readJson(req);
        const result = await acceptHeartbeat({ token: match[1], payload, store: agentStore, now: clock() });
        sendJson(res, result.status, result.body || { error: result.error });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" });
      }
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });
}

async function main() {
  const host = process.env.HASA_API_HOST || "127.0.0.1";
  const port = Number(process.env.HASA_API_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("HASA_API_PORT must be an integer between 1 and 65535");
  const server = createAppServer();
  server.listen(port, host, () => console.log(`HASA BOT NETWORK API v${VERSION} listening on ${host}:${port}`));
  const shutdown = signal => server.close(error => {
    if (error) { console.error("API shutdown failed:", error.message); process.exitCode = 1; }
    else console.log(`Received ${signal}; API server closed.`);
  });
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("HASA API startup failed:", error.message); process.exitCode = 1; });
}
