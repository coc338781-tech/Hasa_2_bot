import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server.js";
import { hashSecret } from "../src/enrollment.js";

test("registered server agent can claim and complete only its own allow-listed pairing jobs", async () => {
  const token = "agent-token-".padEnd(48, "x");
  const serverId = "11111111-1111-4111-8111-111111111111";
  const jobId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const agentStore = {
    async findActiveServerByTokenHash(hash) {
      assert.equal(hash, hashSecret(token));
      return { id: serverId, status: "online", last_heartbeat_at: new Date().toISOString(), memory_available_bytes: 2 * 1024 * 1024 * 1024 };
    }
  };
  const job = { id: jobId, server_id: serverId, bot_instance_id: "33333333-3333-4333-8333-333333333333",
    customer_id: "44444444-4444-4444-8444-444444444444", job_type: "pairing_start", status: "running",
    payload: { pairing_request_id: "55555555-5555-4555-8555-555555555555", phone_e164: "+94771234567" } };
  const provisioningStore = {
    async getMinFreeMemoryBytes() { return 768 * 1024 * 1024; },
    async claimNextJob(id) { assert.equal(id, serverId); return job; },
    async getJobForServer(id, server) { assert.equal(id, jobId); assert.equal(server, serverId); return job; },
    async finishJob(id, server, result) { calls.push({ type: "finish", id, server, result }); return true; },
    async markCodeReady(pairingId, customerId) { calls.push({ type: "code_ready", pairingId, customerId }); return true; },
    async updatePairingStatus(pairingId, customerId, status, failureCode) { calls.push({ type: "status", pairingId, customerId, status, failureCode }); return true; }
  };
  const pairingCodeStore = {
    async put(value) { calls.push({ type: "put", value }); },
    async delete(id) { calls.push({ type: "delete", id }); }
  };
  const server = createAppServer({ agentStore, provisioningStore, pairingCodeStore });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  try {
    const claim = await fetch(`${base}/v1/agent/jobs/claim`, { method: "POST", headers, body: "{}" });
    assert.equal(claim.status, 200);
    assert.equal((await claim.json()).job.id, jobId);
    const code = await fetch(`${base}/v1/agent/pairing-code`, {
      method: "POST", headers, body: JSON.stringify({ job_id: jobId, code: "ABCD-EFGH", expires_at: new Date(Date.now()+60_000).toISOString() })
    });
    assert.equal(code.status, 200);
    assert.equal(calls.find(x => x.type === "put").value.customerId, job.customer_id);
    assert.ok(calls.some(x => x.type === "code_ready"));
    const finished = await fetch(`${base}/v1/agent/jobs/finish`, {
      method: "POST", headers, body: JSON.stringify({ job_id: jobId, status: "succeeded", result: { accepted: true } })
    });
    assert.equal(finished.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("unknown server agent tokens cannot claim jobs", async () => {
  const server = createAppServer({ agentStore: { async findActiveServerByTokenHash() { return null; } }, provisioningStore: {} });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/agent/jobs/claim`, {
      method: "POST", headers: { authorization: `Bearer ${"x".repeat(48)}`, "content-type": "application/json" }, body: "{}"
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
