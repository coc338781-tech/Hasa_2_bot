import test from "node:test";
import assert from "node:assert/strict";
import { parseOperations, parseTime, buildPlan, buildTtsInteractionRequest, extractTtsAudio } from "../plugins/video-studio.js";

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
