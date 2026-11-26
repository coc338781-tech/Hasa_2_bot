import test from "node:test";
import assert from "node:assert/strict";
import { parseOperations, parseTime } from "../plugins/video-studio.js";

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
