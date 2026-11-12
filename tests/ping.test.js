import test from "node:test";
import assert from "node:assert/strict";
import { sendPing } from "../plugins/core.js";

test("ping edits its measuring message with the measured send acknowledgement time", async () => {
  const calls = [];
  const sock = {
    async sendMessage(jid, content, options) {
      calls.push({ jid, content, options });
      if (calls.length === 1) return { key: { remoteJid: jid, id: "ping-1", fromMe: true } };
      return { key: options?.edit || null };
    }
  };
  const message = { key: { id: "incoming-1" } };
  await sendPing(sock, "12345@s.whatsapp.net", message);
  assert.equal(calls.length, 2);
  assert.match(calls[0].content.text, /Measuring WhatsApp response/);
  assert.match(calls[1].content.text, /^⚡ \*Ping: \d+ ms\*$/);
  assert.equal(calls[1].content.edit.id, "ping-1");
  assert.equal(calls[0].options.quoted, message);
});

test("ping falls back to a normal reply if editing the measuring message fails", async () => {
  const calls = [];
  const sock = {
    async sendMessage(jid, content, options) {
      calls.push({ content, options });
      if (calls.length === 1) return { key: { id: "ping-2" } };
      if (content.edit) throw new Error("edit unsupported");
      return { key: { id: "fallback" } };
    }
  };
  await sendPing(sock, "12345@s.whatsapp.net", { key: { id: "incoming-2" } });
  assert.equal(calls.length, 3);
  assert.match(calls[2].content.text, /^⚡ \*Ping: \d+ ms\*$/);
  assert.ok(calls[2].options.quoted);
});
