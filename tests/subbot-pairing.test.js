import test from "node:test";
import assert from "node:assert/strict";
import { formatSubbotPairingCode } from "../lib/subbot-manager.js";

test("formats pairing code into WhatsApp-friendly groups", () => {
  assert.equal(formatSubbotPairingCode("ABCD1234"), "ABCD-1234");
  assert.equal(formatSubbotPairingCode("ABCD 1234"), "ABCD-1234");
});

test("handles empty or short pairing codes safely", () => {
  assert.equal(formatSubbotPairingCode(""), "");
  assert.equal(formatSubbotPairingCode("123"), "123");
});
