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
