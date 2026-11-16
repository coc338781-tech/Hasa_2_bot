import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enrollAgent, loadCredentials, runAgent, sendHeartbeat } from "../src/agent.js";

const serverId = "123e4567-e89b-42d3-a456-426614174000";
const token = "agent-token-for-tests-only-0123456789abcdef0123456789";

test("agent enrollment stores the unique credential with restrictive permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hasa-agent-"));
  const path = join(dir, "private", "credentials.json");
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://control.example/v1/agent/enroll");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { ticket: "ticket-for-tests-only-0123456789abcdef" });
    return new Response(JSON.stringify({ server_id: serverId, agent_token: token, server_label: "Oracle test" }), { status: 200 });
  };
  try {
    const result = await enrollAgent({
      baseUrl: "https://control.example",
      ticket: "ticket-for-tests-only-0123456789abcdef",
      credentialPath: path,
      fetchImpl
    });
    assert.equal(result.server_id, serverId);
    assert.deepEqual(await loadCredentials(path), { server_id: serverId, agent_token: token });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path, "utf8")).includes(token), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent heartbeat sends telemetry with its bearer credential", async () => {
  let sent;
  const fetchImpl = async (url, options) => {
    sent = { url, options };
    return new Response(JSON.stringify({ accepted: true, server_id: serverId }), { status: 200 });
  };
  const result = await sendHeartbeat({
    baseUrl: "https://control.example",
    credentials: { server_id: serverId, agent_token: token },
    fetchImpl,
    dataPath: "/"
  });
  assert.equal(result.accepted, true);
  assert.equal(sent.url, "https://control.example/v1/agent/heartbeat");
  assert.equal(sent.options.headers.Authorization, `Bearer ${token}`);
  const payload = JSON.parse(sent.options.body);
  assert.equal(payload.server_id, serverId);
  assert.match(payload.request_id, /^[0-9a-f-]{36}$/i);
  assert.equal(typeof payload.memory_total_bytes, "number");
  assert.equal(Array.isArray(payload.load_average), true);
});

test("agent refuses non-HTTPS remote API endpoints", async () => {
  await assert.rejects(
    runAgent({ env: { HASA_AGENT_API_URL: "http://control.example" } }),
    /requires HTTPS/
  );
});
