import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findSavedSubbotOwners } from "../lib/subbot-manager.js";

test("saved registered Subbot sessions are discovered for startup restore", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-subbot-restore-"));
  try {
    for (const [owner, registered] of [["94770000000", true], ["94771111111", false]]) {
      const dir = path.join(root, owner);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify({ registered }));
    }
    fs.mkdirSync(path.join(root, "not-a-number"), { recursive: true });
    assert.deepEqual(findSavedSubbotOwners(root), ["94770000000"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("automatic restore discovery is restricted to configured owners", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-subbot-owners-"));
  try {
    for (const owner of ["94770000000", "94771111111"]) {
      const dir = path.join(root, owner);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify({ registered: true }));
    }
    assert.deepEqual(findSavedSubbotOwners(root, ["+94 770 000 000"]), ["94770000000"]);
    assert.deepEqual(findSavedSubbotOwners(root, []), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing or malformed Subbot session folders are safely ignored", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-subbot-empty-"));
  try {
    fs.mkdirSync(path.join(root, "94772222222"), { recursive: true });
    fs.writeFileSync(path.join(root, "94773333333"), "not-a-directory");
    assert.deepEqual(findSavedSubbotOwners(root), []);
    assert.deepEqual(findSavedSubbotOwners(path.join(root, "missing")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
