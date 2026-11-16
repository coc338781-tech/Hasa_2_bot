import test from "node:test";
import assert from "node:assert/strict";
import { createAgentWorkerClient } from "../worker/src/agent-client.js";
test("worker client authenticates and claims only through the HTTPS control plane", async () => {
  const calls = [];
  const client = createAgentWorkerClient({
    apiUrl: "https://network.example/",
    token: "a".repeat(48),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, async json() { return { job: { id: "job-1" } }; } };
    }
  });
  const job = await client.claimNextJob();
  assert.equal(job.id, "job-1");
  assert.equal(calls[0].url, "https://network.example/v1/agent/jobs/claim");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${"a".repeat(48)}`);
});
test("worker client rejects non-HTTPS remote API URLs and short tokens", () => {
  assert.throws(() => createAgentWorkerClient({ apiUrl: "http://network.example", token: "a".repeat(48) }), /requires_https/);
  assert.throws(() => createAgentWorkerClient({ apiUrl: "https://network.example", token: "short" }), /credentials_required/);
});
