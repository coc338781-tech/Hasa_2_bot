import test from "node:test";
import assert from "node:assert/strict";
import { deleteAllSubbots, restartAllSubbots } from "../lib/subbot-bulk.js";

test("bulk restart attempts each unique saved owner and reports failures", async () => {
  const calls = [];
  const result = await restartAllSubbots(["94770000001", "94770000001", "94770000002"], {
    stop: async owner => calls.push("stop:" + owner),
    start: async owner => { calls.push("start:" + owner); if (owner.endsWith("2")) throw new Error("session invalid"); }
  });
  assert.deepEqual(calls, ["stop:94770000001", "start:94770000001", "stop:94770000002", "start:94770000002"]);
  assert.deepEqual(result.map(item => item.ok), [true, false]);
  assert.match(result[1].error, /session invalid/);
});

test("bulk delete attempts every unique owner without stopping on one failure", async () => {
  const removed = [];
  const result = await deleteAllSubbots(["94770000001", "94770000001", "94770000002"], async owner => {
    removed.push(owner);
    if (owner.endsWith("1")) throw new Error("locked");
  });
  assert.deepEqual(removed, ["94770000001", "94770000002"]);
  assert.deepEqual(result.map(item => item.ok), [false, true]);
});
