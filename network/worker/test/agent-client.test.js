import test from "node:test";
import assert from "node:assert/strict";
import { createAgentWorkerClient } from "../src/agent-client.js";

test("worker retrieves the current owner-managed minimum free RAM policy", async () => {
  const calls = [];
  const client = createAgentWorkerClient({
    apiUrl: "https://control.example.test",
    token: "a".repeat(48),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ min_free_memory_bytes: 1024 * 1024 * 1024 }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
  });
  const settings = await client.getSettings();
  assert.equal(settings.minFreeMemoryBytes, 1024 * 1024 * 1024);
  assert.match(calls[0].url, /\/v1\/agent\/settings$/);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${"a".repeat(48)}`);
});

test("worker claim sends local RAM and active instance capacity signals", async () => {
  let sent;
  const client = createAgentWorkerClient({
    apiUrl: "https://control.example.test",
    token: "b".repeat(48),
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({ job: null }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const activeId = "22222222-2222-4222-8222-222222222222";
  await client.claimNextJob({ capacityAvailable: false, memoryAvailable: true, activeInstanceIds: [activeId] });
  assert.equal(sent.capacity_available, false);
  assert.equal(sent.memory_available, true);
  assert.deepEqual(sent.active_instance_ids, [activeId]);
});
