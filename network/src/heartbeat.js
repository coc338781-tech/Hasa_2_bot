import { createHash, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function hashAgentToken(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeEqualHex(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function validateHeartbeat(payload, now = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "invalid_payload";
  const stringFields = ["server_id", "hostname", "os_name", "os_release", "architecture", "agent_version", "request_id", "observed_at"];
  for (const key of stringFields) {
    if (typeof payload[key] !== "string" || payload[key].length < 1 || payload[key].length > 255) return "invalid_payload";
  }
  if (!UUID_RE.test(payload.server_id) || !UUID_RE.test(payload.request_id)) return "invalid_payload";
  if (!Number.isInteger(payload.cpu_cores) || payload.cpu_cores < 1 || payload.cpu_cores > 4096) return "invalid_payload";
  for (const key of ["memory_total_bytes", "memory_available_bytes", "disk_total_bytes", "disk_available_bytes"]) {
    if (!Number.isSafeInteger(payload[key]) || payload[key] < 0) return "invalid_payload";
  }
  if (payload.memory_available_bytes > payload.memory_total_bytes || payload.disk_available_bytes > payload.disk_total_bytes) return "invalid_payload";
  if (!Array.isArray(payload.load_average) || payload.load_average.length !== 3 || payload.load_average.some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1e7)) return "invalid_payload";
  const observed = Date.parse(payload.observed_at);
  if (!Number.isFinite(observed) || Math.abs(now - observed) > MAX_CLOCK_SKEW_MS) return "stale_timestamp";
  return null;
}

export async function acceptHeartbeat({ token, payload, store, now = Date.now() }) {
  if (!store || typeof store.findActiveServerByTokenHash !== "function" || typeof store.recordHeartbeat !== "function") {
    return { status: 503, error: "heartbeat_storage_unavailable" };
  }
  const tokenHash = hashAgentToken(token);
  const server = await store.findActiveServerByTokenHash(tokenHash);
  if (!server || !safeEqualHex(tokenHash, server.token_hash)) return { status: 401, error: "unauthorized" };
  const validationError = validateHeartbeat(payload, now);
  if (validationError) return { status: 400, error: validationError };
  if (payload.server_id !== server.id) return { status: 403, error: "server_identity_mismatch" };

  const accepted = await store.recordHeartbeat(server.id, payload, now);
  if (!accepted) return { status: 409, error: "replayed_request" };
  return { status: 200, body: { accepted: true, server_id: server.id } };
}
