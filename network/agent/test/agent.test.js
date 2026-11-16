import test from "node:test";
import assert from "node:assert/strict";
import { collectTelemetry, getAvailableMemoryBytes } from "../src/agent.js";

test("telemetry reports host capacity without secrets or process data", async () => {
  const data = await collectTelemetry("/");
  for (const key of [
    "hostname", "os_name", "os_release", "architecture", "agent_version",
    "cpu_cores", "load_average", "memory_total_bytes", "memory_available_bytes",
    "disk_total_bytes", "disk_available_bytes", "observed_at"
  ]) assert.ok(key in data, `missing ${key}`);

  assert.ok(data.cpu_cores > 0);
  assert.ok(data.memory_total_bytes > 0);
  assert.ok(data.memory_available_bytes >= 0);
  assert.ok(data.disk_total_bytes > 0);
  assert.ok(data.disk_available_bytes >= 0);
  assert.equal("env" in data, false);
  assert.equal("processes" in data, false);
  assert.equal("session" in data, false);
  assert.equal("token" in data, false);
});

test("Linux telemetry uses MemAvailable rather than raw free pages", async () => {
  const available = await getAvailableMemoryBytes({
    readFileImpl: async () => "MemTotal: 4096000 kB\\nMemAvailable: 123456 kB\\n",
    fallback: () => 1
  });
  if (process.platform === "linux") assert.equal(available, 123456 * 1024);
  else assert.equal(available, 1);
});
