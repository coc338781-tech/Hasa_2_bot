import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStatusRecovery } from "../lib/status-recovery.js";

function temporaryStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-status-recovery-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "queue.json");
}

function status(id) {
  return {
    key: { remoteJid: "status@broadcast", participant: "94770000000@s.whatsapp.net", id },
    message: { conversation: "status" },
    messageTimestamp: Math.floor(Date.now() / 1000)
  };
}

test("persists pending statuses, deduplicates them, and marks them read", async t => {
  const file = temporaryStore(t);
  const recovery = createStatusRecovery(file);
  const item = status("status-1");

  assert.equal(await recovery.enqueue(item), true);
  assert.equal(await recovery.enqueue(item), false);

  const restartedRecovery = createStatusRecovery(file);
  const read = [];
  await restartedRecovery.flush({
    ws: { isOpen: true },
    readMessages: async keys => read.push(...keys)
  });

  assert.equal(read.length, 1);
  assert.equal(read[0].id, "status-1");

  const secondRead = [];
  await createStatusRecovery(file).flush({
    ws: { isOpen: true },
    readMessages: async keys => secondRead.push(...keys)
  });
  assert.equal(secondRead.length, 0);
});

test("keeps failed reads pending and retries them later", async t => {
  const file = temporaryStore(t);
  const recovery = createStatusRecovery(file);
  await recovery.enqueue(status("status-retry"));

  await recovery.flush({
    ws: { isOpen: true },
    readMessages: async () => { throw new Error("temporary failure"); }
  });

  const read = [];
  await createStatusRecovery(file).flush({
    ws: { isOpen: true },
    readMessages: async keys => read.push(...keys)
  });
  assert.equal(read.length, 1);
  assert.equal(read[0].id, "status-retry");
});

test("processes statuses enqueued while a recovery flush is already running", async t => {
  const file = temporaryStore(t);
  const recovery = createStatusRecovery(file);
  await recovery.enqueue(status("status-first"));
  const read = [];

  await recovery.flush({
    ws: { isOpen: true },
    readMessages: async keys => {
      read.push(...keys);
      if (keys[0].id === "status-first") {
        await recovery.enqueue(status("status-arrived-during-flush"));
      }
    }
  });

  assert.deepEqual(read.map(key => key.id), [
    "status-first",
    "status-arrived-during-flush"
  ]);
});
