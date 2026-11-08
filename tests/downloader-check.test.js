import test from "node:test";
import assert from "node:assert/strict";
import { checkDownloaderTools } from "../lib/downloader-check.js";

test("downloader diagnostic reports installed tools", async () => {
  const result = await checkDownloaderTools(async name => ({ stdout: name === "yt-dlp" ? "2026.01.01" : "ffmpeg version 7.0" }));
  assert.deepEqual(result.map(item => item.ok), [true, true]);
  assert.match(result[0].version, /2026/);
});

test("downloader diagnostic reports missing tools without throwing", async () => {
  const result = await checkDownloaderTools(async name => { const error = new Error("missing"); error.code = "ENOENT"; error.path = name; throw error; });
  assert.deepEqual(result.map(item => item.ok), [false, false]);
});
