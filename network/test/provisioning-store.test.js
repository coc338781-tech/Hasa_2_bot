import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresProvisioningStore } from "../src/postgres-provisioning-store.js";

function fakePool(responses = []) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      return responses.shift() || { rowCount: 0, rows: [] };
    },
    release() {}
  };
  return { calls, async connect() { return client; }, async query(sql, params) { return client.query(sql, params); } };
}
test("pairing jobs are enqueued only for a fresh online server assigned to the owned bot", async () => {
  const pool = fakePool([
    { rowCount: 1, rows: [{ id: "bot", server_id: "server", server_status: "online", last_heartbeat_at: new Date().toISOString() }] }
  ]);
  const store = createPostgresProvisioningStore(pool);
  const result = await store.enqueuePairing({ customerId: "customer", botId: "bot", phone: "+94771234567", expiresAt: new Date(Date.now()+600000).toISOString() });
  assert.equal(result.ok, true);
  assert.equal(result.request.status, "queued");
  assert.ok(pool.calls.some(x => x.sql.includes("INSERT INTO provisioning_jobs")));
  assert.ok(pool.calls.some(x => x.sql.includes("INSERT INTO pairing_requests")));
});
test("pairing jobs are rejected when the assigned server is unavailable", async () => {
  const pool = fakePool([{ rowCount: 1, rows: [{ id: "bot", server_id: null, server_status: null, last_heartbeat_at: null }] }]);
  const result = await createPostgresProvisioningStore(pool).enqueuePairing({ customerId: "customer", botId: "bot", phone: "+94771234567", expiresAt: new Date(Date.now()+600000).toISOString() });
  assert.deepEqual(result, { ok: false, reason: "server_unavailable" });
  assert.equal(pool.calls.some(x => x.sql.includes("INSERT INTO provisioning_jobs")), false);
});
test("worker claims jobs with a database lease and skip-locked semantics", async () => {
  const pool = fakePool([{ rowCount: 1, rows: [{ id: "job", bot_instance_id: "bot", customer_id: "customer", payload: { pairing_request_id: "pair", phone_e164: "+94771234567" }, attempts: 1 }] }]);
  const job = await createPostgresProvisioningStore(pool).claimNextJob("server");
  assert.equal(job.id, "job");
  assert.ok(pool.calls.some(x => x.sql.includes("FOR UPDATE SKIP LOCKED")));
});

test("owner assignment requires a live server with the configured RAM reserve", async () => {
  const pool = fakePool([
    { rowCount: 1, rows: [{ id: "server", memory_available_bytes: 2 * 1024 * 1024 * 1024 }] },
    { rowCount: 1, rows: [{ id: "bot", customer_id: "customer", server_id: "server" }] }
  ]);
  const result = await createPostgresProvisioningStore(pool).assignBotToServer({ botId: "bot", serverId: "server" });
  assert.equal(result.ok, true);
  assert.ok(pool.calls.some(x => x.sql.includes("bot.assign_server")));
});
test("owner assignment rejects servers below the RAM safety reserve", async () => {
  const pool = fakePool([{ rowCount: 1, rows: [{ id: "server", memory_available_bytes: 128 * 1024 * 1024 }] }]);
  const result = await createPostgresProvisioningStore(pool).assignBotToServer({ botId: "bot", serverId: "server" });
  assert.deepEqual(result, { ok: false, reason: "server_low_memory" });
});
