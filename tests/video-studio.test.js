import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { parseOperations, parseTime, buildPlan, buildTtsInteractionRequest, extractTtsAudio, normalizeAiEditPlan, asBaileysStream } from "../plugins/video-studio.js";

test("Baileys 7 media uploads receive readable streams in the required object shape", () => {
  const stream = Readable.from([Buffer.from("test-video")]);
  const upload = asBaileysStream(stream);
  assert.deepEqual(Object.keys(upload), ["stream"]);
  assert.equal(upload.stream, stream);
  assert.throws(() => asBaileysStream(undefined), /stream is invalid/);
});

test("parseOperations keeps multi-word Sinhala captions and splits chained edits", () => {
  assert.deepEqual(parseOperations("quality 1080 | speed 0.8 | caption අද මගේ ලස්සන දවස | mute"), [
    { name: "quality", value: "1080" },
    { name: "speed", value: "0.8" },
    { name: "caption", value: "අද මගේ ලස්සන දවස" },
    { name: "mute", value: "" }
  ]);
});

test("parseOperations ignores empty separators", () => {
  assert.deepEqual(parseOperations(" | quality 720 || mute | "), [
    { name: "quality", value: "720" },
    { name: "mute", value: "" }
  ]);
});

test("parseTime accepts seconds and mm:ss and hh:mm:ss", () => {
  assert.equal(parseTime("12.5"), 12.5);
  assert.equal(parseTime("01:30"), 90);
  assert.equal(parseTime("01:02:03.5"), 3723.5);
});

test("parseTime rejects malformed timestamps", () => {
  assert.throws(() => parseTime("1:2:3:4"), /Time/);
  assert.throws(() => parseTime("abc"), /Time/);
});

test("Gemini 3.8 TTS uses the documented Interactions API request schema", () => {
  const request = buildTtsInteractionRequest("ආයුබෝවන්", {
    videoStudio: { ttsModel: "gemini-3.8-flash-tts", ttsVoice: "Kore", ttsStyle: "warm Sinhala narration" }
  });
  assert.equal(request.model, "gemini-3.8-flash-tts");
  assert.deepEqual(request.input[0].content[0], {
    type: "text",
    text: "ආයුබෝවන්",
    annotations: [{ type: "speech_metadata", style: "warm Sinhala narration" }]
  });
  assert.deepEqual(request.generation_config.speech_config, [{ voice: "Kore" }]);
  assert.deepEqual(request.response_format, { type: "audio" });
});

test("Gemini TTS audio extraction reads Interactions API model output", () => {
  assert.equal(extractTtsAudio({
    steps: [{ type: "model_output", content: [{ type: "audio", data: "UklGRg==" }] }]
  }), "UklGRg==");
  assert.equal(extractTtsAudio({ output_audio: { data: "UklGRg==" } }), "UklGRg==");
  assert.equal(extractTtsAudio({ steps: [] }), null);
});

test("GIF export is encoded as WhatsApp-compatible MP4 playback", () => {
  const plan = buildPlan([{ name: "gif", value: "" }], "/tmp/input.mp4", "/tmp/output.mp4",
    "/tmp", { videoStudio: { ffmpegThreads: 1 } }, true, 2);
  assert.equal(plan.outputFormat, "gif");
  assert.ok(plan.args.includes("libx264"));
  assert.ok(plan.args.includes("yuv420p"));
  assert.ok(!plan.args.includes("-loop"));
});

test("the last music operation wins when music is removed in the same job", () => {
  const plan = buildPlan([
    { name: "music", value: "/tmp/work/music.wav" },
    { name: "music", value: "remove" }
  ], "/tmp/input.mp4", "/tmp/output.mp4", "/tmp/work",
  { videoStudio: { ffmpegThreads: 1 } }, true, 2);
  assert.equal(plan.args.filter(value => value === "-i").length, 1);
  assert.ok(!plan.args.includes("-stream_loop"));
});

test("Gemini auto-edit values are clamped to safe bounds and missing values use neutral defaults", () => {
  const plan = normalizeAiEditPlan({
    brightness: 9,
    contrast: -4,
    saturation: null,
    speed: 0,
    filter: "unexpected",
    format: "unexpected",
    caption: "  සිංහල caption  "
  });
  assert.deepEqual(plan, [
    { name: "filter", value: "none" },
    { name: "brightness", value: "0.1" },
    { name: "contrast", value: "0.9" },
    { name: "saturation", value: "1" },
    { name: "speed", value: "0.8" },
    { name: "caption", value: "සිංහල caption" }
  ]);
});

test("Gemini auto-edit normalizer handles JSON strings, object arrays, and malformed responses safely", () => {
  const wrapped = normalizeAiEditPlan(JSON.stringify(JSON.stringify({
    filter: "warm", brightness: 0.05, contrast: 1.1, saturation: 1.2, speed: 1.05
  })));
  assert.ok(wrapped.some(item => item.name === "filter" && item.value === "warm"));
  assert.ok(wrapped.some(item => item.name === "speed" && item.value === "1.05"));

  const listed = normalizeAiEditPlan([null, { filter: "bw", format: "9:16" }]);
  assert.ok(listed.some(item => item.name === "filter" && item.value === "bw"));
  assert.ok(listed.some(item => item.name === "format" && item.value === "9:16"));

  assert.deepEqual(normalizeAiEditPlan(null), [
    { name: "filter", value: "none" },
    { name: "brightness", value: "0" },
    { name: "contrast", value: "1" },
    { name: "saturation", value: "1" },
    { name: "speed", value: "1" }
  ]);
});


test("FFmpeg uses single-thread filters and encoders by default", () => {
  const plan = buildPlan([{ name: "quality", value: "720" }], "/tmp/input.mp4", "/tmp/output.mp4", "/tmp", {}, true, 2);
  assert.ok(plan.args.includes("-filter_threads"));
  assert.equal(plan.args[plan.args.indexOf("-filter_threads") + 1], "1");
  assert.ok(!plan.args.includes("-filter_complex_threads"));
  assert.equal(plan.args[plan.args.indexOf("-threads") + 1], "1");
});

test("Reverse editing is bounded to 15 seconds and downscales before frame buffering", () => {
  const plan = buildPlan([{ name: "reverse", value: "" }], "/tmp/input.mp4", "/tmp/output.mp4", "/tmp", {}, true, 15);
  const filters = plan.args[plan.args.indexOf("-vf") + 1];
  assert.match(filters, /scale=640:360/);
  assert.match(filters, /fps=15/);
  assert.match(filters, /reverse/);
  assert.throws(() => buildPlan([{ name: "reverse", value: "" }], "/tmp/input.mp4", "/tmp/output.mp4", "/tmp", {}, true, 15.1), /15/);
});
