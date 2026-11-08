import test from "node:test";
import assert from "node:assert/strict";
import ai from "../plugins/ai.js";

test("AI command without prompt or quoted media shows usage", async () => {
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  await ai({
    sock,
    message: { key: { remoteJid: "chat@s.whatsapp.net" }, message: { conversation: ".ai" } },
    config: { prefix: ".", aiChat: false }
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0][1].text, /HASA AI ASSISTANT/);
});

test("AI plugin ignores similarly prefixed non-AI commands", async () => {
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  await ai({
    sock,
    message: { key: { remoteJid: "chat@s.whatsapp.net" }, message: { conversation: ".aichat on" } },
    config: { prefix: ".", aiChat: false }
  });
  assert.equal(sent.length, 0);
});
