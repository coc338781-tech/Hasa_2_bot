import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBotRuntime } from "../worker/src/bot-runtime.js";
test("bot instance creation builds an isolated config with the customer's own WhatsApp owner number", async () => {
  const root = await mkdtemp(join(tmpdir(), "hasa-bot-runtime-"));
  const code = await mkdtemp(join(tmpdir(), "hasa-bot-code-"));
  const id = "11111111-1111-4111-8111-111111111111";
  try {
    await import("node:fs/promises").then(({ copyFile }) => copyFile(new URL("../../config.example.json", import.meta.url), join(code, "config.example.json")));
    const runtime = createBotRuntime({ dataDir: root, codeDir: code, baileys: { async useMultiFileAuthState() { return { state: { creds: { registered: true } } }; } } });
    await runtime.createInstance({ bot_instance_id: id });
    await runtime.setOwnerPhone(id, "+94779876543");
    const config = JSON.parse(await readFile(join(root, id, "config.json"), "utf8"));
    assert.deepEqual(config.owner, ["94779876543"]);
    assert.equal(config.downloadDir, "downloads");
    assert.ok((await readFile(join(root, id, "config.json"))).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(code, { recursive: true, force: true });
  }
});
test("bot runtime refuses unregistered WhatsApp sessions and unsafe instance identifiers", async () => {
  const root = await mkdtemp(join(tmpdir(), "hasa-bot-runtime-"));
  const code = await mkdtemp(join(tmpdir(), "hasa-bot-code-"));
  try {
    const runtime = createBotRuntime({ dataDir: root, codeDir: code, baileys: { async useMultiFileAuthState() { return { state: { creds: { registered: false } } }; } } });
    await assert.rejects(runtime.createInstance({ bot_instance_id: "../escape", payload: { owner_phone: "94771234567" } }), /invalid_instance_id/);
    await mkdir(join(root, "11111111-1111-4111-8111-111111111111"), { recursive: true });
    await assert.rejects(runtime.startInstance("11111111-1111-4111-8111-111111111111"), /whatsapp_session_not_registered/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(code, { recursive: true, force: true });
  }
});

test("bot runtime identifies the registered WhatsApp phone without exposing auth credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "hasa-bot-runtime-"));
  const id = "33333333-3333-4333-8333-333333333333";
  try {
    const runtime = createBotRuntime({
      dataDir: root,
      codeDir: root,
      baileys: { async useMultiFileAuthState() { return { state: { creds: { registered: true, me: { id: "94779876543:12@s.whatsapp.net" } } } }; } }
    });
    assert.equal(await runtime.getRegisteredPhone(id), "94779876543");
  } finally { await rm(root, { recursive: true, force: true }); }
});
