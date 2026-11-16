import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server.js";
import { hashAgentToken } from "../src/heartbeat.js";

const serverId = "123e4567-e89b-42d3-a456-426614174000";
const requestId = "123e4567-e89b-42d3-a456-426614174001";
const token = "test-agent-token-which-is-long-enough-123456";
const now = Date.parse("2026-11-16T18:00:00.000Z");
const payload = (extra = {}) => ({
  server_id: serverId, request_id: requestId, hostname: "test-host", os_name: "Linux",
  os_release: "test", architecture: "arm64", agent_version: "0.1.0", cpu_cores: 4,
  load_average: [0.1, 0.2, 0.3], memory_total_bytes: 1000, memory_available_bytes: 500,
  disk_total_bytes: 2000, disk_available_bytes: 1000, observed_at: new Date(now).toISOString(), ...extra
});
async function withServer(store, run) {
  const server = createAppServer({ agentStore: store, clock: () => now });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
test("authenticated heartbeat stores telemetry and returns minimal acknowledgement", async () => {
  let recorded;
  const store = {
    async findActiveServerByTokenHash(hash) { return hash === hashAgentToken(token) ? { id: serverId, token_hash: hash } : null; },
    async recordHeartbeat(id, data) { recorded = { id, data }; return true; }
  };
  await withServer(store, async base => {
    const response = await fetch(base + "/v1/agent/heartbeat", { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true, server_id: serverId });
    assert.equal(recorded.id, serverId);
    assert.equal(recorded.data.request_id, requestId);
  });
});
test("heartbeat rejects missing credentials, stale data and replayed request IDs", async () => {
  const store = {
    async findActiveServerByTokenHash(hash) { return hash === hashAgentToken(token) ? { id: serverId, token_hash: hash } : null; },
    async recordHeartbeat() { return false; }
  };
  await withServer(store, async base => {
    const noAuth = await fetch(base + "/v1/agent/heartbeat", { method: "POST", body: JSON.stringify(payload()) });
    assert.equal(noAuth.status, 401);
    const stale = await fetch(base + "/v1/agent/heartbeat", { method: "POST",
      headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload({ observed_at: "2020-01-01T00:00:00.000Z" })) });
    assert.equal(stale.status, 400);
    const replay = await fetch(base + "/v1/agent/heartbeat", { method: "POST",
      headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload()) });
    assert.equal(replay.status, 409);
  });
});
test("heartbeat fails closed without persistent storage adapter", async () => {
  await withServer(null, async base => {
    const response = await fetch(base + "/v1/agent/heartbeat", { method: "POST",
      headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(payload()) });
    assert.equal(response.status, 503);
  });
});
