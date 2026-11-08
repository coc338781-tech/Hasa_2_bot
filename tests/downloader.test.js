import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import downloader, { explainDownloadError } from "../plugins/downloader.js";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-downloader-"));
  const sent = [];
  const sock = { async sendMessage(jid, payload) { sent.push({ jid, payload }); } };
  const message = { key: { remoteJid: "chat@s.whatsapp.net" }, message: { conversation: ".dl https://example.com/video" } };
  return { dir, sent, sock, message, config: { prefix: ".", downloadDir: dir } };
}

test("downloader checks tools, sends the video, and removes its temporary file", async () => {
  const state = fixture();
  const calls = [];
  const execCommand = async (command, args) => {
    calls.push([command, args]);
    if (args.includes("--version") || args[0] === "-version") return { stdout: "ok" };
    const template = args[args.indexOf("-o") + 1];
    fs.writeFileSync(template.replace("%(ext)s", "mp4"), Buffer.from("video-data"));
    return { stdout: "" };
  };
  try {
    await downloader({ ...state, execCommand });
    assert.deepEqual(calls.map(call => call[0]), ["yt-dlp", "ffmpeg", "yt-dlp"]);
    assert.match(state.sent[0].payload.text, /VIDEO DOWNLOADING/);
    assert.equal(state.sent[1].payload.video.toString(), "video-data");
    assert.match(state.sent[1].payload.caption, /DOWNLOAD COMPLETED/);
    assert.equal(fs.readdirSync(state.dir).length, 0);
  } finally {
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("downloader reports missing ffmpeg clearly and does not run a download", async () => {
  const state = fixture();
  const execCommand = async command => {
    if (command === "ffmpeg") {
      const error = new Error("spawn ffmpeg ENOENT");
      error.code = "ENOENT";
      error.path = "ffmpeg";
      throw error;
    }
    return { stdout: "ok" };
  };
  try {
    await downloader({ ...state, execCommand });
    assert.equal(state.sent.length, 2);
    assert.match(state.sent[1].payload.text, /ffmpeg/);
  } finally {
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("downloader rejects invalid links without starting external tools", async () => {
  const state = fixture();
  state.message.message.conversation = ".dl not-a-url";
  let called = false;
  try {
    await downloader({ ...state, execCommand: async () => { called = true; } });
    assert.equal(called, false);
    assert.match(state.sent[0].payload.text, /INVALID LINK/);
  } finally {
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("download errors provide useful size and timeout explanations", () => {
  assert.match(explainDownloadError(new Error("File is larger than max-filesize")), /64 MB/);
  const timeout = new Error("timed out");
  timeout.killed = true;
  assert.match(explainDownloadError(timeout), /වැඩි වෙලාවක්/);
});
