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

test("failed Pornhub category listing keeps a retry action", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  let attempts = 0;
  const execCommand = async (command, args, options) => {
    if (args.includes("--flat-playlist")) {
      attempts++;
      if (attempts === 1) {
        const error = new Error("curl: (35) Recv failure: Connection reset by peer");
        error.stderr = error.message;
        throw error;
      }
    }
    return state.execCommand(command, args, options);
  };
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("1", true) });
    assert.match(state.sent.at(-1).payload.text, /connection එක.*reset/i);
    assert.match(state.sent.at(-1).payload.text, /0.*නැවත උත්සාහ/);
    await xvdl({ ...state, execCommand, message: state.makeMessage("0", true) });
    assert.equal(attempts, 2);
    assert.match(state.sent.at(-1).payload.text, /Public sample video/);
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
    assert.ok(metadataArgs.includes("6"));
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("xHamster creator profile keeps playlist mode enabled", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  let listingArgs;
  const execCommand = async (command, args) => {
    if (args.includes("--flat-playlist")) {
      listingArgs = args;
      return { stdout: JSON.stringify({ entries: [{
        title: "Creator public video",
        webpage_url: "https://xhamster.com/videos/creator-public-video-123",
        filesize_approx: 12 * 1024 * 1024,
        duration: 90
      }] }) };
    }
    return state.execCommand(command, args);
  };
  try {
    await xvdl({ ...state, execCommand, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("2", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("https://xhamster.com/users/demo/videos", true) });
    assert.ok(listingArgs.includes("--flat-playlist"));
    assert.ok(!listingArgs.includes("--no-playlist"));
    assert.match(state.sent.at(-1).payload.text, /Creator public video/);
    assert.match(state.sent.at(-1).payload.text, /12.0 MB/);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("Xvdl rejects files above 200 MiB and removes the temporary file", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  const fileSystem = {
    ...fs,
    statSync(file) {
      const stat = fs.statSync(file);
      if (String(file).includes("xvdl-")) return { size: 200 * 1024 * 1024 + 1, isFile: () => true };
      return stat;
    }
  };
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    await xvdl({ ...state, message: state.makeMessage("1", true), fileSystem });
    assert.match(state.sent.at(-1).payload.text, /200 MB/);
    assert.equal(state.sent.some(item => item.payload.video), false);
    assert.equal(fs.readdirSync(state.dir).length, 0);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});
