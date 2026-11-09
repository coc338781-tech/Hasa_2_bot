import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createDeleteOnReadPlugin } from "../plugins/delete-on-read.js";

function setup() {
  const events = new EventEmitter();
  const sent = [];
  let nextId = 0;
  const sock = {
    ev: events,
    async sendMessage(jid, payload) {
      sent.push({ jid, payload });
      if (payload.text) {
        nextId += 1;
        return { key: { remoteJid: jid, id: "sent-" + nextId, fromMe: true } };
      }
      return {};
    }
  };
  const plugin = createDeleteOnReadPlugin();
  plugin.onConnection(sock);
  return { sock, sent, plugin, events };
}

test(".D removes the command and sends only the requested text", async () => {
  const state = setup();
  const commandKey = { remoteJid: "94771111111@s.whatsapp.net", id: "cmd-1", fromMe: true };
  await state.plugin.run({
    sock: state.sock,
    message: { key: commandKey, message: { conversation: ".D හායි" } },
    config: { prefix: "." }
  });
  assert.deepEqual(state.sent[0], { jid: commandKey.remoteJid, payload: { delete: commandKey } });
  assert.deepEqual(state.sent[1], { jid: commandKey.remoteJid, payload: { text: "හායි" } });
  assert.equal(state.plugin.pending.size, 1);
});

test("delivery acknowledgement does not delete; read status does", async () => {
  const state = setup();
  const jid = "94771111111@s.whatsapp.net";
  await state.plugin.run({
    sock: state.sock,
    message: { key: { remoteJid: jid, id: "cmd-2", fromMe: true }, message: { conversation: ".D Hello" } },
    config: { prefix: "." }
  });
  const sentKey = { remoteJid: jid, id: "sent-1", fromMe: true };
  state.events.emit("messages.update", [{ key: sentKey, update: { status: 3 } }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.sent.length, 2);
  state.events.emit("messages.update", [{ key: sentKey, update: { status: 4 } }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(state.sent[2], { jid, payload: { delete: sentKey } });
  assert.equal(state.plugin.pending.size, 0);
});

test("ignores incoming messages and group chats", async () => {
  const state = setup();
  await state.plugin.run({
    sock: state.sock,
    message: { key: { remoteJid: "94771111111@s.whatsapp.net", id: "in-1", fromMe: false }, message: { conversation: ".D nope" } },
    config: { prefix: "." }
  });
  await state.plugin.run({
    sock: state.sock,
    message: { key: { remoteJid: "123@g.us", id: "group-1", fromMe: true }, message: { conversation: ".D nope" } },
    config: { prefix: "." }
  });
  assert.equal(state.sent.length, 0);
  assert.equal(state.plugin.pending.size, 0);
});
