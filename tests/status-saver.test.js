import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STATUS_SAVE_ALIASES,
  findStatusForCommand,
  getStatusSaveAliases,
  findStatusMedia,
  normalizeStatusAlias
} from "../lib/status-saver.js";

test("default aliases include English and Sinhala commands", () => {
  assert.ok(DEFAULT_STATUS_SAVE_ALIASES.includes("save"));
  assert.ok(DEFAULT_STATUS_SAVE_ALIASES.includes("සේව්"));
  assert.equal(normalizeStatusAlias(".Save"), "save");
});

test("configured aliases are normalized and deduplicated", () => {
  assert.deepEqual(getStatusSaveAliases({ statusSaveAliases: [".Save", "dpn", "DPn", ""] }), ["save", "dpn"]);
});

test("finds a status from a quoted status reply", () => {
  const status = { key: { remoteJid: "status@broadcast", id: "status-1", participant: "94770000000@s.whatsapp.net" }, message: { imageMessage: { caption: "original" } } };
  const cache = new Map([["status@broadcast:status-1", status]]);
  const command = {
    message: {
      extendedTextMessage: {
        text: ".save",
        contextInfo: {
          quotedMessage: {
            extendedTextMessage: {
              text: "reply",
              contextInfo: {
                stanzaId: "status-1",
                participant: "94770000000@s.whatsapp.net"
              }
            }
          }
        }
      }
    }
  };
  assert.equal(findStatusForCommand(command, cache, "94770000000@s.whatsapp.net"), status);
});

test("finds the newest outgoing status reply in the same chat", () => {
  const status = { key: { remoteJid: "status@broadcast", id: "status-2", participant: "94770000000@s.whatsapp.net" }, message: { videoMessage: {} } };
  const reply = { key: { remoteJid: "94770000000@s.whatsapp.net", id: "reply-1", fromMe: true }, message: { extendedTextMessage: { text: "Nice", contextInfo: { stanzaId: "status-2", participant: "94770000000@s.whatsapp.net" } } } };
  const cache = new Map([
    ["status@broadcast:status-2", status],
    ["94770000000@s.whatsapp.net:reply-1", reply]
  ]);
  const command = { message: { conversation: ".save" } };
  assert.equal(findStatusForCommand(command, cache, "94770000000@s.whatsapp.net"), status);
});

test("detects supported status media", () => {
  assert.equal(findStatusMedia({ message: { imageMessage: {} } })[0], "imageMessage");
  assert.equal(findStatusMedia({ message: { videoMessage: {} } })[0], "videoMessage");
  assert.equal(findStatusMedia({ message: { conversation: "text" } }), null);
});
