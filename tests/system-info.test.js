import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatUptime, buildSystemInfo } from "../plugins/system.js";

test("formatBytes formats invalid values safely", () => {
  assert.equal(formatBytes(-1), "N/A");
  assert.equal(formatBytes(Number.NaN), "N/A");
  assert.match(formatBytes(1024), /1\.0 KB/);
});

test("formatUptime includes days and zero-padded time", () => {
  assert.equal(formatUptime(90061), "1d 01h 01m 01s");
  assert.equal(formatUptime(65), "00h 01m 05s");
});

test("system card contains server, memory, storage and bot details", async () => {
  globalThis.__hasaPlugins = { count: 10 };
  const output = await buildSystemInfo({
    sock: { user: { id: "947000000000:1@s.whatsapp.net" } },
    config: { botName: "Hasa_2_bot", publicMode: true, fastMode: true }
  });
  for (const label of ["SERVER DETAILS", "CPU:", "CPU Cores:", "CPU Usage:", "Server Uptime:", "MEMORY & STORAGE", "RAM Used:", "RAM Free:", "Bot Memory:", "Disk Used:", "BOT DETAILS", "Status: Connected", "Bot Uptime:", "Node.js:", "Baileys:", "Plugins: 10 Active", "Mode: Public", "Fast Mode: ON"]) {
    assert.ok(output.includes(label), "missing " + label);
  }
  delete globalThis.__hasaPlugins;
});
