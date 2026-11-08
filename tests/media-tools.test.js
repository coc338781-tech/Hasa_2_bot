import test from "node:test";
import assert from "node:assert/strict";
import mediaTools from "../plugins/media-tools.js";

test("sticker command explains how to use media tools when no media is quoted", async () => {
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  await mediaTools({
    sock,
    message: { key: { remoteJid: "chat@s.whatsapp.net" }, message: { conversation: ".sticker" } },
    config: { prefix: "." }
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0][1].text, /HASA MEDIA TOOLS/);
  assert.match(sent[0][1].text, /\.toaudio/);
});

test("media tools ignore unrelated commands", async () => {
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  await mediaTools({
    sock,
    message: { key: { remoteJid: "chat@s.whatsapp.net" }, message: { conversation: ".ping" } },
    config: { prefix: "." }
  });
  assert.equal(sent.length, 0);
});
