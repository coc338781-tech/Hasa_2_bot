import test from "node:test";
import assert from "node:assert/strict";
import antiDelete from "../plugins/anti-delete.js";

function setup({ original, mode = true, toInbox = false, failText = false, failMedia = false } = {}) {
  const sent = [];
  const deleted = [];
  const cache = {
    get: key => key === "chat@g.us:original-1" ? original : undefined,
    delete: key => deleted.push(key)
  };
  const sock = {
    user: { id: "94770000000:4@s.whatsapp.net" },
    async sendMessage(target, payload) {
      if (payload.text && failText) throw new Error("text failure");
      if (payload.forward && failMedia) throw new Error("media failure");
      sent.push({ target, payload });
    }
  };
  const message = {
    key: { remoteJid: "chat@g.us", id: "delete-1" },
    message: { protocolMessage: {
      type: 0,
      key: { remoteJid: "chat@g.us", id: "original-1", participant: "94771111111@s.whatsapp.net" }
    } }
  };
  return { sent, deleted, cache, sock, message, config: { antiDelete: mode, antiDeleteToInbox: toInbox } };
}

test("anti-delete restores text and clears the delivered cache entry", async () => {
  const state = setup({ original: { message: { conversation: "hello" } } });
  await antiDelete(state);
  assert.match(state.sent[0].payload.text, /hello/);
  assert.deepEqual(state.sent[0].payload.mentions, ["94771111111@s.whatsapp.net"]);
  assert.deepEqual(state.deleted, ["chat@g.us:original-1"]);
});

test("anti-delete ignores messages deleted by the owner", async () => {
  const state = setup({ original: { message: { conversation: "my own message" } } });
  state.message.message.protocolMessage.key.fromMe = true;
  await antiDelete(state);
  assert.equal(state.sent.length, 0);
  assert.deepEqual(state.deleted, []);
});

test("anti-delete forwards media and supports the owner inbox target", async () => {
  const original = { message: { imageMessage: { caption: "photo" } } };
  const state = setup({ original, toInbox: true });
  await antiDelete(state);
  assert.equal(state.sent.length, 2);
  assert.equal(state.sent[0].target, "94770000000@s.whatsapp.net");
  assert.equal(state.sent[1].payload.forward, original);
  assert.deepEqual(state.deleted, ["chat@g.us:original-1"]);
});

test("anti-delete keeps the cache entry when all delivery attempts fail", async () => {
  const state = setup({
    original: { message: { videoMessage: {} } },
    failText: true,
    failMedia: true
  });
  await antiDelete(state);
  assert.deepEqual(state.deleted, []);
});

test("anti-delete respects groups-only mode in private chats", async () => {
  const state = setup({ original: { message: { conversation: "hello" } }, mode: "groups" });
  state.message.key.remoteJid = "94772222222@s.whatsapp.net";
  state.message.message.protocolMessage.key.remoteJid = "94772222222@s.whatsapp.net";
  await antiDelete(state);
  assert.equal(state.sent.length, 0);
  assert.deepEqual(state.deleted, []);
});

test("anti-delete finds cached message when revoke JID differs but message ID matches uniquely", async () => {
  const original = {
    key: { remoteJid: "94771111111@lid", id: "original-1" },
    message: { conversation: "cached before revoke" }
  };
  const state = setup({ original });
  state.message.message.protocolMessage.key.remoteJid = "chat@g.us";
  state.cache.entries = () => [["94771111111@lid:original-1", original]];
  await antiDelete(state);
  assert.match(state.sent[0].payload.text, /cached before revoke/);
  assert.deepEqual(state.deleted, ["chat@g.us:original-1"]);
});
