import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import xvdl, { resetXvdlStateForTests } from "../plugins/xvdl.js";

function fixture({ owner = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-xvdl-"));
  const sent = [];
  const sock = { async sendMessage(jid, payload) { sent.push({ jid, payload }); } };
  const config = { prefix: ".", owner: ["94770000000"], downloadDir: dir };
  const makeMessage = (text, fromMe = owner) => ({
    key: { remoteJid: (fromMe ? "94770000000" : "94771111111") + "@s.whatsapp.net", fromMe },
    message: { conversation: text }
  });
  const execCommand = async (command, args) => {
    if (args.includes("--dump-single-json")) {
      return { stdout: JSON.stringify({
        entries: [{
          title: "Public sample video",
          webpage_url: "https://www.pornhub.com/view_video.php?viewkey=sample123",
          filesize_approx: 50 * 1024 * 1024,
          duration: 125
        }]
      }) };
    }
    if (args.includes("--version") || args[0] === "-version") return { stdout: "ok" };
    const template = args[args.indexOf("-o") + 1];
    fs.writeFileSync(template.replace("%(ext)s", "mp4"), Buffer.from("sample-video"));
    return { stdout: "" };
  };
  return { dir, sent, sock, config, makeMessage, execCommand };
}

test("non-owner must self-confirm 18+ before the source menu", async () => {
  resetXvdlStateForTests();
  const state = fixture();
  try {
    await xvdl({ ...state, message: state.makeMessage(".Xvdl", false) });
    assert.match(state.sent[0].payload.text, /18\+ AGE CONFIRMATION/);
    await xvdl({ ...state, message: state.makeMessage("18", false) });
    assert.match(state.sent[1].payload.text, /Pornhub/);
    assert.match(state.sent[1].payload.text, /xHamster/);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("owner goes directly to source menu without age prompt", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    assert.equal(state.sent.length, 1);
    assert.match(state.sent[0].payload.text, /Pornhub/);
    assert.doesNotMatch(state.sent[0].payload.text, /AGE CONFIRMATION/);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("Pornhub category selection lists metadata and sends selected file from disk", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    assert.match(state.sent.at(-1).payload.text, /PORNHub CATEGORIES/);
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    assert.match(state.sent.at(-1).payload.text, /Public sample video/);
    assert.match(state.sent.at(-1).payload.text, /50\.0 MB/);
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    const video = state.sent.find(item => item.payload.video)?.payload.video;
    assert.ok(video?.url.startsWith(state.dir));
    assert.ok(!Object.hasOwn(video || {}, "buffer"));
    assert.equal(fs.readdirSync(state.dir).length, 0);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("xHamster rejects non-xHamster URLs", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("2", true) });
    await xvdl({ ...state, message: state.makeMessage("https://example.com/videos/sample", true) });
    assert.match(state.sent.at(-1).payload.text, /Public xHamster/);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("video listing uses bounded metadata output", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  let metadataArgs;
  const execCommand = async (command, args) => {
    if (args.includes("--dump-single-json")) {
      metadataArgs = args;
      return { stdout: JSON.stringify({ entries: [] }) };
    }
    return state.execCommand(command, args);
  };
  try {
    await xvdl({ ...state, execCommand, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("1", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("1", true) });
    assert.ok(metadataArgs.includes("--playlist-end"));
    assert.ok(metadataArgs.includes("8"));
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});
