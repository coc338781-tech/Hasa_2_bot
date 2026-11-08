import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PersistentMessageCache } from "../lib/message-cache.js";

function temporaryFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-cache-test-"));
  return { directory, file: path.join(directory, "messages.bin") };
}

test("message cache survives a process restart and preserves media bytes", () => {
  const temp = temporaryFile();
  try {
    const original = {
      key: { remoteJid: "123@s.whatsapp.net", id: "message-1" },
      message: { imageMessage: { caption: "saved image", jpegThumbnail: Buffer.from([1, 2, 3]) } }
    };
    const first = new PersistentMessageCache({ file: temp.file, flushDelayMs: 60_000 });
    first.set("123@s.whatsapp.net:message-1", original);
    assert.equal(first.flush(), true);

    const restored = new PersistentMessageCache({ file: temp.file, flushDelayMs: 60_000 });
    const result = restored.get("123@s.whatsapp.net:message-1");
    assert.equal(result.message.imageMessage.caption, "saved image");
    assert.deepEqual(result.message.imageMessage.jpegThumbnail, Buffer.from([1, 2, 3]));
    restored.clear();
    restored.flush();
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true });
  }
});

test("message cache enforces the configured entry limit", () => {
  const temp = temporaryFile();
  try {
    const cache = new PersistentMessageCache({ file: temp.file, maxEntries: 2, flushDelayMs: 60_000 });
    cache.set("one", { message: { conversation: "one" } });
    cache.set("two", { message: { conversation: "two" } });
    cache.set("three", { message: { conversation: "three" } });
    assert.equal(cache.size, 2);
    assert.equal(cache.has("one"), false);
    assert.equal(cache.has("two"), true);
    assert.equal(cache.has("three"), true);
    cache.clear();
    cache.flush();
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true });
  }
});

test("expired messages are not returned", () => {
  const temp = temporaryFile();
  try {
    const cache = new PersistentMessageCache({ file: temp.file, ttlMs: 0, flushDelayMs: 60_000 });
    cache.set("old", { message: { conversation: "expired" } });
    assert.equal(cache.get("old"), undefined);
    assert.equal(cache.has("old"), false);
    cache.flush();
  } finally {
    fs.rmSync(temp.directory, { recursive: true, force: true });
  }
});
