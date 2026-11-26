import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { buildPlan, parseOperations } from "../plugins/video-studio.js";

const run = promisify(execFile);
const ffmpegAvailable = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

async function makeSample(dir) {
  const input = path.join(dir, "sample.mp4");
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=44100",
    "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", input
  ], { timeout: 30000 });
  return input;
}

test("FFmpeg applies a chained multi-edit job in one export", { skip: !ffmpegAvailable }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-video-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = await makeSample(dir);
  const output = path.join(dir, "edited.mp4");
  const operations = parseOperations("trim 00:00.5 00:01.5 | quality 480 | speed 0.8 | caption HASA STUDIO | filter cinematic | volume 70 | audiofadein 0.2 | format 9:16");
  const plan = buildPlan(operations, input, output, dir, { videoStudio: {} }, true, 2);
  await run("ffmpeg", plan.args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(fs.statSync(output).size > 1000);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", output]);
  const streams = JSON.parse(stdout).streams;
  assert.ok(streams.some(stream => stream.width === 720 && stream.height === 1280));
});

test("music can be mixed with source audio without cutting the video short", { skip: !ffmpegAvailable }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-video-music-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = await makeSample(dir);
  const music = path.join(dir, "music.wav");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", music]);
  const output = path.join(dir, "music-edited.mp4");
  const operations = parseOperations("music " + music + " | musicvolume 30 | volume 70");
  const plan = buildPlan(operations, input, output, dir, { videoStudio: {} }, true, 2);
  await run("ffmpeg", plan.args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(fs.statSync(output).size > 1000);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output]);
  assert.ok(Number(stdout.trim()) >= 1.8);
});

test("voice-over audio is mixed and padded to the video duration", { skip: !ffmpegAvailable }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-video-voiceover-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = await makeSample(dir);
  const voiceover = path.join(dir, "voiceover.wav");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=0.4", voiceover]);
  const output = path.join(dir, "voiceover-edited.mp4");
  const operations = [{ name: "voiceoverfile", value: voiceover }];
  const plan = buildPlan(operations, input, output, dir, { videoStudio: {} }, true, 2);
  await run("ffmpeg", plan.args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(fs.statSync(output).size > 1000);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output]);
  assert.ok(Number(stdout.trim()) >= 1.8);
});

test("GIF export produces an MP4 video suitable for WhatsApp GIF playback", { skip: !ffmpegAvailable }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-video-gif-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = await makeSample(dir);
  const output = path.join(dir, "animated.mp4");
  const plan = buildPlan([{ name: "gif", value: "" }], input, output, dir,
    { videoStudio: {} }, true, 2);
  await run("ffmpeg", plan.args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(fs.statSync(output).size > 1000);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=format_name:stream=codec_name,codec_type", "-of", "json", output]);
  const data = JSON.parse(stdout);
  assert.match(data.format.format_name, /mp4/);
  assert.ok(data.streams.some(stream => stream.codec_type === "video" && stream.codec_name === "h264"));
  assert.ok(!data.streams.some(stream => stream.codec_type === "audio"));
});
