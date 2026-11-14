import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePhoneNumber,
  extractMessageText,
  summarizeDailyStats,
  isPrivateChat
} from "../plugins/personal-assistant.js";

test("normalizes Sri Lankan local and international numbers", () => {
  assert.equal(normalizePhoneNumber("077 123 4567"), "94771234567");
  assert.equal(normalizePhoneNumber("+94 77 123 4567"), "94771234567");
  assert.equal(normalizePhoneNumber("0094-77-123-4567"), "94771234567");
  assert.equal(normalizePhoneNumber("not a number"), "");
});

test("extracts supported WhatsApp text and captions", () => {
  assert.equal(extractMessageText({ message: { conversation: "Hello" } }), "Hello");
  assert.equal(extractMessageText({ message: { extendedTextMessage: { text: "Hi" } } }), "Hi");
  assert.equal(extractMessageText({ message: { imageMessage: { caption: "Photo" } } }), "Photo");
  assert.equal(extractMessageText({ message: {} }), "");
});

test("summarizes daily incoming message totals and unique senders", () => {
  const summary = summarizeDailyStats({
    "2026-11-14": {
      total: 5,
      bySender: {
        "94770000001@s.whatsapp.net": 3,
        "94770000002@s.whatsapp.net": 2
      }
    }
  }, "2026-11-14");
  assert.equal(summary.total, 5);
  assert.equal(summary.people, 2);
  assert.deepEqual(summary.bySender.map(item => item.count), [3, 2]);
});

test("smart replies are scoped to one-to-one chats, including Baileys LID JIDs", () => {
  assert.equal(isPrivateChat("94770000001@s.whatsapp.net"), true);
  assert.equal(isPrivateChat("123456789@lid"), true);
  assert.equal(isPrivateChat("123456789@g.us"), false);
  assert.equal(isPrivateChat("status@broadcast"), false);
});
