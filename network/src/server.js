import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, extname } from "node:path";
import { acceptHeartbeat } from "./heartbeat.js";
import { exchangeEnrollmentTicket, hashSecret } from "./enrollment.js";
import { createOwnerSession, verifyOwnerSession, createEnrollmentTicketValue } from "./owner-auth.js";
import {
  normalizeEmail, normalizePhone, hashPassword, verifyPassword,
  createCustomerSessionToken, hashCustomerToken, readCustomerBearer,
  CUSTOMER_SESSION_TTL_MS
} from "./customer-auth.js";
import { randomUUID } from "node:crypto";

const VERSION = "0.5.0";
const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const STATIC_TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const STATIC_FILES = {
  "/": "index.html", "/index.html": "index.html", "/site.css": "site.css", "/site.js": "site.js",
  "/owner": "owner.html", "/owner/": "owner.html", "/owner.css": "owner.css", "/owner.js": "owner.js",
  "/customer": "customer.html", "/customer/": "customer.html", "/customer.css": "customer.css", "/customer.js": "customer.js"
};
const MAX_BODY_BYTES = 16 * 1024;
const enrollmentAttempts = new Map();
const ownerLoginAttempts = new Map();
const customerLoginAttempts = new Map();
const customerRegisterAttempts = new Map();
const customerPairingAttempts = new Map();
function rateLimited(map, key, now, limit) {
  const entry = map.get(key) || { start: now, count: 0 };
  if (now - entry.start >= 60_000) { entry.start = now; entry.count = 0; }
  entry.count += 1;
  map.set(key, entry);
  if (map.size > 5000) map.clear();
  return entry.count > limit;
}
function enrollmentRateLimited(key, now) { return rateLimited(enrollmentAttempts, key, now, 5); }
function ownerLoginRateLimited(key, now) { return rateLimited(ownerLoginAttempts, key, now, 5); }
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
async function issueCustomerSession(customerStore, customerId, now) {
  const token = createCustomerSessionToken();
  await customerStore.createSession({
    customerId, tokenHash: hashCustomerToken(token),
    expiresAt: new Date(now + CUSTOMER_SESSION_TTL_MS).toISOString()
  });
  return token;
}

export function createAppServer({ agentStore = null, customerStore = null, provisioningStore = null, pairingCodeStore = null, clock = () => Date.now() } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    if (req.method === "GET" && Object.hasOwn(STATIC_FILES, req.url)) {
      try {
        const filename = STATIC_FILES[req.url];
        const content = await readFile(join(PUBLIC_DIR, filename));
        res.writeHead(200, {
          "Content-Type": STATIC_TYPES[extname(filename)],
          "Content-Length": content.length,
          "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "X-Frame-Options": "DENY"
        });
        res.end(content);
      } catch { sendJson(res, 500, { error: "website_unavailable" }); }
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      sendJson(res, 200, { service: "hasa-bot-network-api", status: "ok", version: VERSION, timestamp: new Date(clock()).toISOString() });
      return;
    }
    if (req.method === "GET" && req.url === "/readyz") {
      const ready = Boolean(agentStore && customerStore);
      sendJson(res, ready ? 200 : 503, { service: "hasa-bot-network-api", ready, database: ready ? "configured" : "not_configured" });
      return;
    }

    if (req.method === "POST" && req.url === "/v1/customer/register") {
      const remote = req.socket.remoteAddress || "unknown";
      if (rateLimited(customerRegisterAttempts, remote, clock(), 3)) { sendJson(res, 429, { error: "rate_limited" }); return; }
      if (!customerStore) { sendJson(res, 503, { error: "customer_auth_unavailable" }); return; }
      try {
        const body = await readJson(req);
        const email = normalizeEmail(body?.email);
        const phone = normalizePhone(body?.phone);
        const displayName = typeof body?.display_name === "string" && body.display_name.trim().length <= 80 ? body.display_name.trim() : "";
        if (!email || !phone || typeof body?.password !== "string" || body.password.length < 12 || body.password.length > 128 || (body.display_name != null && !displayName)) {
          sendJson(res, 400, { error: "invalid_registration" }); return;
        }
        const passwordHash = await hashPassword(body.password);
        const customer = await customerStore.createCustomer({ email, phone, displayName, passwordHash });
        const accessToken = await issueCustomerSession(customerStore, customer.id, clock());
        sendJson(res, 201, { authenticated: true, access_token: accessToken, expires_in_seconds: CUSTOMER_SESSION_TTL_MS / 1000, customer: { id: customer.id, email: customer.email, phone_e164: customer.phone_e164 } });
      } catch (error) {
        if (error.code === "23505") { sendJson(res, 409, { error: "account_exists" }); return; }
        if (error.status) { sendJson(res, error.status, { error: error.message }); return; }
        sendJson(res, 500, { error: "customer_auth_unavailable" });
      }
      return;
    }
    if (req.method === "POST" && req.url === "/v1/customer/login") {
      const remote = req.socket.remoteAddress || "unknown";
      if (rateLimited(customerLoginAttempts, remote, clock(), 8)) { sendJson(res, 429, { error: "rate_limited" }); return; }
      if (!customerStore) { sendJson(res, 503, { error: "customer_auth_unavailable" }); return; }
      try {
        const body = await readJson(req);
        const email = normalizeEmail(body?.email);
        if (!email || typeof body?.password !== "string" || body.password.length > 128) { sendJson(res, 401, { error: "invalid_credentials" }); return; }
        const account = await customerStore.findAccountByEmail(email);
        const valid = account && !account.disabled_at && account.customer_status === "active" && await verifyPassword(body.password, account.password_hash);
        if (!valid) { sendJson(res, 401, { error: "invalid_credentials" }); return; }
        const accessToken = await issueCustomerSession(customerStore, account.customer_id, clock());
        sendJson(res, 200, { authenticated: true, access_token: accessToken, expires_in_seconds: CUSTOMER_SESSION_TTL_MS / 1000 });
      } catch (error) { sendJson(res, 500, { error: "customer_auth_unavailable" }); }
      return;
    }

    const bearer = readCustomerBearer(req);
    const customerTokenHash = bearer ? hashCustomerToken(bearer) : null;
    const customerSession = customerStore && customerTokenHash
      ? await customerStore.findCustomerBySession(customerTokenHash, new Date(clock())).catch(() => null)
      : null;
    if (req.method === "GET" && req.url === "/v1/customer/me") {
      if (!customerSession) { sendJson(res, 401, { error: "customer_authentication_required" }); return; }
      try {
        const data = await customerStore.getCustomerDashboard(customerSession.id);
        if (!data) { sendJson(res, 404, { error: "customer_not_found" }); return; }
        const { customer_id, display_name, phone_e164, account_status, login_email, bot_id, bot_status, release_version, last_started_at, last_stopped_at, last_error_code, pairing_id, pairing_status, pairing_phone, pairing_expires_at, pairing_created_at } = data;
        sendJson(res, 200, {
          customer: { id: customer_id, display_name, phone_e164, status: account_status, login_email },
          bot: bot_id ? { id: bot_id, status: bot_status, release_version, last_started_at, last_stopped_at, last_error_code } : null,
          latest_pairing: pairing_id ? { id: pairing_id, status: pairing_status, phone_e164: pairing_phone, expires_at: pairing_expires_at, created_at: pairing_created_at } : null
        });
      } catch { sendJson(res, 500, { error: "customer_data_unavailable" }); }
      return;
    }
    if (req.method === "POST" && req.url === "/v1/customer/logout") {
      if (!customerSession || !customerTokenHash) { sendJson(res, 401, { error: "customer_authentication_required" }); return; }
      await customerStore.revokeSession(customerTokenHash).catch(() => false);
      sendJson(res, 200, { authenticated: false });
      return;
    }
    if (req.method === "POST" && req.url === "/v1/customer/pairing-requests") {
      if (!customerSession) { sendJson(res, 401, { error: "customer_authentication_required" }); return; }
      if (rateLimited(customerPairingAttempts, customerSession.id, clock(), 3)) { sendJson(res, 429, { error: "rate_limited" }); return; }
      try {
        const body = await readJson(req);
        const phone = normalizePhone(body?.phone);
        if (!phone) { sendJson(res, 400, { error: "invalid_phone" }); return; }
        const dashboard = await customerStore.getCustomerDashboard(customerSession.id);
        if (!dashboard?.bot_id) { sendJson(res, 409, { error: "bot_instance_not_assigned" }); return; }
        const request = await customerStore.createPairingRequest({
          customerId: customerSession.id, botId: dashboard.bot_id, phone,
          expiresAt: new Date(clock() + 10 * 60 * 1000).toISOString()
        });
        if (!request) { sendJson(res, 404, { error: "bot_instance_not_found" }); return; }
        if (!request.ok) { sendJson(res, request.reason === "server_unavailable" ? 503 : 404, { error: request.reason }); return; }
        sendJson(res, 202, { accepted: true, request: request.request, worker: "queued" });
      } catch { sendJson(res, 500, { error: "pairing_request_unavailable" }); }
      return;
    }

    const pairingCodeMatch = req.method === "GET" && /^\\/v1\\/customer\\/pairing-requests\\/([0-9a-f-]{36})\\/code$/.exec(req.url || "");
    if (pairingCodeMatch) {
      if (!customerSession) { sendJson(res, 401, { error: "customer_authentication_required" }); return; }
      if (!pairingCodeStore) { sendJson(res, 503, { error: "pairing_code_vault_unavailable" }); return; }
      try {
        const dashboard = await customerStore.getCustomerDashboard(customerSession.id);
        if (!dashboard || dashboard.pairing_id !== pairingCodeMatch[1] || dashboard.pairing_status !== "code_ready") {
          sendJson(res, 404, { error: "pairing_code_not_available" }); return;
        }
        const code = await pairingCodeStore.take({ pairingId: pairingCodeMatch[1], customerId: customerSession.id });
        if (!code) { sendJson(res, 404, { error: "pairing_code_expired_or_already_viewed" }); return; }
        sendJson(res, 200, code);
      } catch { sendJson(res, 500, { error: "pairing_code_unavailable" }); }
      return;
    }

    if (req.method === "POST" && req.url === "/v1/owner/login") {
      const remote = req.socket.remoteAddress || "unknown";
      if (ownerLoginRateLimited(remote, clock())) { sendJson(res, 429, { error: "rate_limited" }); return; }
      try {
        const body = await readJson(req);
        const session = createOwnerSession(body?.access_key, process.env.HASA_OWNER_ACCESS_KEY, clock());
        if (!session) { sendJson(res, 401, { error: "invalid_owner_credentials" }); return; }
        sendJson(res, 200, { authenticated: true, access_token: session, expires_in_seconds: 1800 });
      } catch (error) { sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" }); }
      return;
    }
    const assignBotMatch = req.method === "POST" && /^\\/v1\\/owner\\/bots\\/([0-9a-f-]{36})\\/assign-server$/.exec(req.url || "");
    if (assignBotMatch) {
      if (!ownerAuthorized(req, process.env.HASA_OWNER_ACCESS_KEY, clock())) { sendJson(res, 401, { error: "owner_authentication_required" }); return; }
      if (!customerStore || typeof customerStore.assignBotToServer !== "function") { sendJson(res, 503, { error: "provisioning_storage_unavailable" }); return; }
      try {
        const body = await readJson(req);
        const serverId = typeof body?.server_id === "string" ? body.server_id : "";
        if (!/^[0-9a-f-]{36}$/i.test(serverId)) { sendJson(res, 400, { error: "invalid_server_id" }); return; }
        const result = await customerStore.assignBotToServer({ botId: assignBotMatch[1], serverId });
        sendJson(res, result.ok ? 200 : result.reason === "server_not_online" ? 409 : 404, result);
      } catch { sendJson(res, 500, { error: "bot_assignment_failed" }); }
      return;
    }
    if (req.method === "GET" && req.url === "/v1/owner/bots") {
      if (!ownerAuthorized(req, process.env.HASA_OWNER_ACCESS_KEY, clock())) { sendJson(res, 401, { error: "owner_authentication_required" }); return; }
      if (!provisioningStore || typeof provisioningStore.listBots !== "function") { sendJson(res, 503, { error: "provisioning_storage_unavailable" }); return; }
      try { sendJson(res, 200, { bots: await provisioningStore.listBots() }); }
      catch { sendJson(res, 500, { error: "bot_inventory_unavailable" }); }
      return;
    }
    if (req.method === "GET" && req.url === "/v1/owner/servers") {
      if (!ownerAuthorized(req, process.env.HASA_OWNER_ACCESS_KEY, clock())) { sendJson(res, 401, { error: "owner_authentication_required" }); return; }
      if (!agentStore || typeof agentStore.listServers !== "function") { sendJson(res, 503, { error: "server_storage_unavailable" }); return; }
      try { sendJson(res, 200, { servers: await agentStore.listServers() }); }
      catch { sendJson(res, 500, { error: "internal_error" }); }
      return;
    }
    const revokeMatch = req.method === "POST" && /^\/v1\/owner\/servers\/([0-9a-f-]{36})\/revoke$/.exec(req.url || "");
    if (revokeMatch) {
      if (!ownerAuthorized(req, process.env.HASA_OWNER_ACCESS_KEY, clock())) { sendJson(res, 401, { error: "owner_authentication_required" }); return; }
      if (!agentStore || typeof agentStore.revokeServer !== "function") { sendJson(res, 503, { error: "server_storage_unavailable" }); return; }
      try {
        const revoked = await agentStore.revokeServer(revokeMatch[1]);
        sendJson(res, revoked ? 200 : 404, revoked ? { revoked: true, server_id: revokeMatch[1] } : { error: "server_not_found_or_disabled" });
      } catch { sendJson(res, 500, { error: "internal_error" }); }
      return;
    }
    if (req.method === "POST" && req.url === "/v1/owner/server-enrollment-tickets") {
      if (!ownerAuthorized(req, process.env.HASA_OWNER_ACCESS_KEY, clock())) { sendJson(res, 401, { error: "owner_authentication_required" }); return; }
      try {
        const body = await readJson(req);
        const label = cleanLabel(body?.label);
        const provider = cleanProvider(body?.provider);
        if (!label || !provider) { sendJson(res, 400, { error: "invalid_server_details" }); return; }
        if (!agentStore || typeof agentStore.createEnrollmentTicket !== "function") { sendJson(res, 503, { error: "enrollment_storage_unavailable" }); return; }
        const ticket = createEnrollmentTicketValue();
        const expiresAt = new Date(clock() + 10 * 60 * 1000).toISOString();
        await agentStore.createEnrollmentTicket({ id: randomUUID(), ticketHash: hashSecret(ticket), label, provider, expiresAt });
        sendJson(res, 201, { ticket, label, provider, expires_at: expiresAt, uses: 1 });
      } catch (error) { sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" }); }
      return;
    }
    const agentClaim = req.method === "POST" && req.url === "/v1/agent/jobs/claim";
    const agentFinish = req.method === "POST" && req.url === "/v1/agent/jobs/finish";
    const agentPairingCode = req.method === "POST" && req.url === "/v1/agent/pairing-code";
    const agentPairingStatus = req.method === "POST" && req.url === "/v1/agent/pairing-status";
    if (agentClaim || agentFinish || agentPairingCode || agentPairingStatus) {
      const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || "");
      if (!match || !agentStore || !provisioningStore) { sendJson(res, 401, { error: "agent_unauthorized" }); return; }
      const server = await agentStore.findActiveServerByTokenHash(hashSecret(match[1])).catch(() => null);
      if (!server) { sendJson(res, 401, { error: "agent_unauthorized" }); return; }
      try {
        if (agentClaim) {
          const job = await provisioningStore.claimNextJob(server.id);
          sendJson(res, 200, { job });
          return;
        }
        const body = await readJson(req);
        const jobId = typeof body?.job_id === "string" && /^[0-9a-f-]{36}$/i.test(body.job_id) ? body.job_id : null;
        if (!jobId) { sendJson(res, 400, { error: "invalid_job_id" }); return; }
        const job = await provisioningStore.getJobForServer(jobId, server.id);
        if (!job || job.job_type !== "pairing_start") { sendJson(res, 404, { error: "job_not_found" }); return; }
        if (agentFinish) {
          const status = body.status;
          if (!["succeeded", "failed", "cancelled"].includes(status)) { sendJson(res, 400, { error: "invalid_job_status" }); return; }
          const finished = await provisioningStore.finishJob(jobId, server.id, {
            status, result: body.result && typeof body.result === "object" ? body.result : null,
            errorCode: typeof body.error_code === "string" ? body.error_code.slice(0, 80) : null
          });
          sendJson(res, finished ? 200 : 404, { finished: Boolean(finished) });
          return;
        }
        if (job.status !== "running" && job.status !== "succeeded") { sendJson(res, 409, { error: "job_not_active" }); return; }
        if (agentPairingCode) {
          if (!pairingCodeStore) { sendJson(res, 503, { error: "pairing_code_vault_unavailable" }); return; }
          const code = typeof body.code === "string" && /^[A-Z0-9-]{4,32}$/.test(body.code) ? body.code : null;
          const expiresAt = typeof body.expires_at === "string" && Number.isFinite(Date.parse(body.expires_at)) ? body.expires_at : null;
          if (!code || !expiresAt) { sendJson(res, 400, { error: "invalid_pairing_code_payload" }); return; }
          const pairingId = job.payload?.pairing_request_id;
          await pairingCodeStore.put({ pairingId, customerId: job.customer_id, code, expiresAt });
          const ready = await provisioningStore.markCodeReady(pairingId, job.customer_id);
          if (!ready) { await pairingCodeStore.delete(pairingId); sendJson(res, 409, { error: "pairing_request_not_active" }); return; }
          sendJson(res, 200, { stored: true });
          return;
        }
        const status = body.status;
        if (!["paired", "expired", "failed", "offline"].includes(status)) { sendJson(res, 400, { error: "invalid_pairing_status" }); return; }
        const updated = await provisioningStore.updatePairingStatus(
          job.payload?.pairing_request_id, job.customer_id, status,
          typeof body.failure_code === "string" ? body.failure_code.slice(0, 80) : null
        );
        await pairingCodeStore?.delete(job.payload?.pairing_request_id);
        sendJson(res, updated ? 200 : 409, { updated });
      } catch (error) {
        sendJson(res, 500, { error: "agent_job_operation_failed" });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/v1/agent/enroll") {
      const remote = req.socket.remoteAddress || "unknown";
      if (enrollmentRateLimited(remote, clock())) { sendJson(res, 429, { error: "rate_limited" }); return; }
      try {
        const body = await readJson(req);
        const result = await exchangeEnrollmentTicket({ ticket: body?.ticket, store: agentStore, now: clock() });
        sendJson(res, result.status, result.body || { error: result.error });
      } catch (error) { sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" }); }
      return;
    }
    if (req.method === "POST" && req.url === "/v1/agent/heartbeat") {
      const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.headers.authorization || "");
      if (!match) { sendJson(res, 401, { error: "unauthorized" }); return; }
      try {
        const payload = await readJson(req);
        const result = await acceptHeartbeat({ token: match[1], payload, store: agentStore, now: clock() });
        sendJson(res, result.status, result.body || { error: result.error });
      } catch (error) { sendJson(res, error.status || 500, { error: error.status ? error.message : "internal_error" }); }
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });
}

async function main() {
  const host = process.env.HASA_API_HOST || "127.0.0.1";
  const port = Number(process.env.HASA_API_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("HASA_API_PORT must be an integer between 1 and 65535");
  const runtime = await import("./runtime.js").then(module => module.createConfiguredAgentStore());
  const server = createAppServer({ agentStore: runtime.store, customerStore: runtime.customerStore, provisioningStore: runtime.provisioningStore, pairingCodeStore: runtime.pairingCodeStore });
  server.listen(port, host, () => console.log(`HASA BOT NETWORK API v${VERSION} listening on ${host}:${port}`));
  const shutdown = signal => server.close(async error => {
    if (runtime.close) await runtime.close().catch(closeError => { console.error("Database shutdown failed:", closeError.message); process.exitCode = 1; });
    if (error) { console.error("API shutdown failed:", error.message); process.exitCode = 1; }
    else console.log(`Received ${signal}; API server closed.`);
  });
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error("HASA API startup failed:", error.message); process.exitCode = 1; });
}
