import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import downloader, { explainDownloadError, safeDownloadDiagnostic } from "../plugins/downloader.js";

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
    assert.ok(state.sent[1].payload.video.url.startsWith(state.dir));
    assert.match(state.sent[1].payload.video.url, /\.mp4$/);
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
  assert.match(explainDownloadError(new Error("File is larger than max-filesize")), /200 MB/);
  const timeout = new Error("timed out");
  timeout.killed = true;
  assert.match(explainDownloadError(timeout), /වැඩි වෙලාවක්/);
});

test("song command searches one result, extracts mp3, and sends audio", async () => {
  const state = fixture();
  state.message.message.conversation = ".song coldplay yellow";
  let downloadArgs;
  const execCommand = async (command, args) => {
    if (args.includes("--version") || args[0] === "-version") return { stdout: "ok" };
    downloadArgs = args;
    const template = args[args.indexOf("-o") + 1];
    fs.writeFileSync(template.replace("%(ext)s", "mp3"), Buffer.from("audio-data"));
    return { stdout: "" };
  };
  try {
    await downloader({ ...state, execCommand });
    assert.equal(downloadArgs.at(-1), "ytsearch1:coldplay yellow");
    assert.ok(downloadArgs.includes("-x"));
    assert.ok(downloadArgs.includes("32M"));
    assert.ok(state.sent[1].payload.audio.url.startsWith(state.dir));
    assert.match(state.sent[1].payload.audio.url, /\.mp3$/);
    assert.equal(state.sent[1].payload.mimetype, "audio/mpeg");
    assert.equal(fs.readdirSync(state.dir).length, 0);
  } finally {
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("video command searches one result and sends video", async () => {
  const state = fixture();
  state.message.message.conversation = ".video nature documentary";
  let downloadArgs;
  const execCommand = async (command, args) => {
    if (args.includes("--version") || args[0] === "-version") return { stdout: "ok" };
    downloadArgs = args;
    const template = args[args.indexOf("-o") + 1];
    fs.writeFileSync(template.replace("%(ext)s", "mp4"), Buffer.from("video-data"));
    return { stdout: "" };
  };
  try {
    await downloader({ ...state, execCommand });
    assert.equal(downloadArgs.at(-1), "ytsearch1:nature documentary");
    assert.ok(!downloadArgs.includes("--max-filesize"), "video downloads must not be rejected by yt-dlp's early filesize estimate");
    assert.ok(downloadArgs.some(value => String(value).includes("height<=480")));
    assert.ok(downloadArgs.some(value => String(value).includes("height<=720")));
    assert.ok(state.sent[1].payload.video.url.startsWith(state.dir));
    assert.match(state.sent[1].payload.video.url, /\.mp4$/);
  } finally {
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("safe downloader diagnostic redacts URLs and secrets", () => {
  const error = new Error("failed");
  error.stderr = "ERROR: [facebook] Unable to download webpage https://facebook.com/watch/?token=secret123456789\\nAuthorization: Bearer secret-token";
  const output = safeDownloadDiagnostic(error);
  assert.match(output, /URL REDACTED/);
  assert.doesNotMatch(output, /secret123456789|secret-token/);
});


test("safe downloader diagnostic falls back to sanitized error messages", () => {
  const error = new Error("Command failed: yt-dlp https://facebook.com/share/v/example ERROR: unable to download media token=secret-value");
  const output = safeDownloadDiagnostic(error);
  assert.match(output, /ERROR|unable/i);
  assert.match(output, /URL REDACTED/);
  assert.doesNotMatch(output, /secret-value|facebook.com/);
});

test("Facebook downloads do not force unsupported browser impersonation", async () => {
  const state = fixture();
  state.message.message.conversation = ".fb https://www.facebook.com/share/r/example/";
  let downloadArgs;
  const execCommand = async (command, args) => {
    if (args.includes("--version") || args[0] === "-version") return { stdout: "ok" };
    downloadArgs = args;
    const template = args[args.indexOf("-o") + 1];
    fs.writeFileSync(template.replace("%(ext)s", "mp4"), Buffer.from("video-data"));
    return { stdout: "" };
  };
  try {
    await downloader({ ...state, execCommand });
    assert.ok(!downloadArgs.includes("--max-downloads"), "single-video downloads must not use yt-dlp max-downloads (it exits 101 even after success)");
    assert.ok(!downloadArgs.includes("--impersonate"));
    assert.ok(!downloadArgs.includes("--list-impersonate-targets"));
    assert.ok(state.sent[1].payload.video.url.startsWith(state.dir));
    assert.match(state.sent[1].payload.video.url, /\.mp4$/);
  } finally {
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});
