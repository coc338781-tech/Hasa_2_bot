import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresAgentStore } from "../src/postgres-agent-store.js";

test("server inventory exposes worker heartbeat and active capacity", async () => {
  let sql = "";
  const pool = {
    async query(statement) {
      sql = String(statement);
      return { rowCount: 0, rows: [] };
    },
    async connect() { throw new Error("not_used"); }
  };
  await createPostgresAgentStore(pool).listServers();
  assert.match(sql, /worker_last_seen_at/);
  assert.match(sql, /worker_active_sessions/);
  assert.match(sql, /worker_status/);
});

test("worker heartbeat updates only the enrolled online server", async () => {
  let call;
  const pool = {
    async query(statement, params) {
      call = { sql: String(statement), params };
      return { rowCount: 1, rows: [{ id: "server" }] };
    },
    async connect() { throw new Error("not_used"); }
  };
  const now = Date.now();
  const result = await createPostgresAgentStore(pool).recordWorkerHeartbeat("server", {
    workerVersion: "0.1.0", maxSessions: 2, activeSessions: 1, now
  });
  assert.equal(result, true);
  assert.match(call.sql, /worker_last_seen_at/);
  assert.match(call.sql, /status = 'online'/);
  assert.equal(call.params[2], "0.1.0");
  assert.equal(call.params[3], 2);
  assert.equal(call.params[4], 1);
});
