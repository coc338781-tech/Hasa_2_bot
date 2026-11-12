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

test("xHamster browser scrapes public category HTML and lists downloadable videos", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  let requestedUrl;
  const html = '<a class="video-thumb" href="/videos/public-category-video-xhAb123" title="Public xHamster category video"><img alt="Public xHamster category video"></a>';
  const execCommand = async (command, args, options) => {
    if (command === "curl") {
      requestedUrl = args.at(-1);
      return { stdout: html };
    }
    if (args.includes("--skip-download")) {
      return { stdout: JSON.stringify({
        title: "Public xHamster category video",
        webpage_url: "https://xhamster.com/videos/public-category-video-xhAb123",
        filesize_approx: 18 * 1024 * 1024,
        duration: 95,
        formats: [{ vcodec: "avc1", height: 480 }]
      }) };
    }
    return state.execCommand(command, args, options);
  };
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("2", true) });
    assert.match(state.sent.at(-1).payload.text, /xHAMSTER BROWSER/);
    await xvdl({ ...state, execCommand, message: state.makeMessage("3", true) });
    assert.equal(requestedUrl, "https://xhamster.com/categories/amateur?sort=newest");
    assert.match(state.sent.at(-1).payload.text, /Public xHamster category video/);
    assert.match(state.sent.at(-1).payload.text, /18.0 MB/);
    await xvdl({ ...state, execCommand, message: state.makeMessage("1", true) });
    assert.ok(state.sent.some(item => item.payload.video));
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("xHamster browser scrapes public keyword search results", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  let requestedUrl;
  const execCommand = async (command, args, options) => {
    if (command === "curl") {
      requestedUrl = args.at(-1);
      return { stdout: '<a href="/videos/search-result-xhAb456" title="Search result video">video</a>' };
    }
    if (args.includes("--skip-download")) {
      return { stdout: JSON.stringify({
        title: "Search result video",
        filesize_approx: 9 * 1024 * 1024,
        duration: 60,
        formats: [{ vcodec: "avc1", height: 480 }]
      }) };
    }
    return state.execCommand(command, args, options);
  };
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("2", true) });
    await xvdl({ ...state, message: state.makeMessage("7", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("amateur", true) });
    assert.equal(requestedUrl, "https://xhamster.com/search/amateur");
    assert.match(state.sent.at(-1).payload.text, /Search result video/);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("Pornhub category falls back to public keyword results when category endpoint fails", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  const requested = [];
  const execCommand = async (command, args, options) => {
    if (args.includes("--flat-playlist")) {
      const url = args.at(-1);
      requested.push(url);
      if (url.includes("/categories/amateur")) {
        const error = new Error("HTTP Error 404: Not Found");
        error.stderr = error.message;
        throw error;
      }
    }
    return state.execCommand(command, args, options);
  };
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("1", true) });
    assert.deepEqual(requested, [
      "https://www.pornhub.com/categories/amateur",
      "https://www.pornhub.com/video/search?search=amateur"
    ]);
    assert.match(state.sent.at(-1).payload.text, /Public sample video/);
    assert.match(state.sent.at(-1).payload.text, /search fallback/);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});

test("failed Pornhub category and search keep a retry action", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  let categoryAttempts = 0;
  let searchAttempts = 0;
  const execCommand = async (command, args, options) => {
    if (args.includes("--flat-playlist")) {
      const url = args.at(-1);
      if (url.includes("/categories/")) {
        categoryAttempts++;
        const error = new Error("HTTP Error 404: Not Found");
        error.stderr = error.message;
        throw error;
      }
      if (url.includes("/video/search")) {
        searchAttempts++;
        if (searchAttempts === 1) {
          const error = new Error("curl: (35) Recv failure: Connection reset by peer");
          error.stderr = error.message;
          throw error;
        }
      }
    }
    return state.execCommand(command, args, options);
  };
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("1", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("1", true) });
    assert.match(state.sent.at(-1).payload.text, /connection එක.*reset/i);
    assert.match(state.sent.at(-1).payload.text, /0.*නැවත උත්සාහ/);
    await xvdl({ ...state, execCommand, message: state.makeMessage("0", true) });
    assert.equal(categoryAttempts, 2);
    assert.equal(searchAttempts, 2);
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
    assert.ok(metadataArgs.includes("20"));
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


test("xHamster estimates a missing size from the selected format bitrate", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  const execCommand = async (command, args, options) => {
    if (command === "curl") {
      return { stdout: '<a href="/videos/estimated-size-xhAb789" title="Estimated size video">video</a>' };
    }
    if (args.includes("--skip-download")) {
      return { stdout: JSON.stringify({
        title: "Estimated size video",
        duration: 95,
        formats: [{ vcodec: "avc1", height: 480, tbr: 1200 }]
      }) };
    }
    return state.execCommand(command, args, options);
  };
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("2", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("1", true) });
    assert.match(state.sent.at(-1).payload.text, /≈ 13\.6 MB/);
    assert.doesNotMatch(state.sent.at(-1).payload.text, /Size නොදනී/);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});


test("XVDL video list supports next and previous pages", async () => {
  resetXvdlStateForTests();
  const state = fixture({ owner: true });
  const requested = [];
  const execCommand = async (command, args, options) => {
    if (command === "curl") {
      const url = args.at(-1);
      requested.push(url);
      const page = new URL(url).searchParams.get("page") || "1";
      return { stdout: '<a href="/videos/page-' + page + '-video-xhAb' + page + '23" title="Page ' + page + ' video">video</a>' };
    }
    if (args.includes("--skip-download")) {
      const pageMatch = String(args.at(-1)).match(/page-(\\d+)-video/i);
      const page = pageMatch?.[1] || "1";
      return { stdout: JSON.stringify({ title: "Page " + page + " video", filesize_approx: 5 * 1024 * 1024, duration: 30 }) };
    }
    return state.execCommand(command, args, options);
  };
  try {
    await xvdl({ ...state, message: state.makeMessage(".xvdl", true) });
    await xvdl({ ...state, message: state.makeMessage("2", true) });
    await xvdl({ ...state, execCommand, message: state.makeMessage("3", true) });
    assert.match(state.sent.at(-1).payload.text, /Page 1 video/);
    await xvdl({ ...state, execCommand, message: state.makeMessage("n", true) });
    assert.ok(requested.at(-1).includes("page=2"));
    assert.match(state.sent.at(-1).payload.text, /Page 2 video/);
    await xvdl({ ...state, execCommand, message: state.makeMessage("p", true) });
    assert.match(state.sent.at(-1).payload.text, /Page 1 video/);
  } finally {
    resetXvdlStateForTests();
    fs.rmSync(state.dir, { recursive: true, force: true });
  }
});
