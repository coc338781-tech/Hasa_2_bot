import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getAiAutoEdit, generateVoiceover } from "../plugins/video-studio.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.log("SKIP: GEMINI_API_KEY is not configured in GitHub Actions secrets; live Gemini calls were not made.");
  process.exit(0);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-gemini-smoke-"));
try {
  const video = path.join(dir, "sample.mp4");
  const voice = path.join(dir, "sinhala-voice.wav");
  const config = {
    videoStudio: {
      aiModel: "gemini-3.8-flash",
      ttsModel: "gemini-3.8-flash-tts",
      ttsVoice: "Kore",
      ttsStyle: "Natural, clear Sinhala narration with warm and friendly delivery",
      fontFile: "/usr/share/fonts/truetype/noto/NotoSansSinhala-Regular.ttf"
    }
  };

  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video
  ], { stdio: "pipe" });

  console.log("TEST 1/2: Gemini 3.8 Flash visual auto-edit request...");
  const plan = await getAiAutoEdit(video, dir, config);
  if (!Array.isArray(plan) || !plan.some(x => x.name === "filter") || !plan.some(x => x.name === "speed")) {
    throw new Error("Gemini Flash returned an incomplete or invalid edit plan.");
  }
  console.log("PASS: Gemini 3.8 Flash returned a validated edit plan (" + plan.map(x => x.name).join(", ") + ").");

  console.log("TEST 2/2: Gemini 3.8 Flash TTS Sinhala voice generation...");
  await generateVoiceover("ආයුබෝවන්! මෙය හසා වීඩියෝ ස්ටුඩියෝ සිංහල හඬ පරීක්ෂණයකි.", voice, config);
  const probe = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type",
    "-of", "json", voice
  ], { encoding: "utf8" }));
  const duration = Number(probe.format?.duration || 0);
  if (!fs.existsSync(voice) || fs.statSync(voice).size < 1024 || !probe.streams?.some(x => x.codec_type === "audio") || !(duration > 0.5 && duration < 60)) {
    throw new Error("Gemini TTS output failed WAV/FFprobe validation.");
  }
  console.log("PASS: Gemini 3.8 Flash TTS generated a valid WAV audio file (" + duration.toFixed(2) + " seconds, " + fs.statSync(voice).size + " bytes).");
  console.log("LIVE GEMINI SMOKE TEST PASSED.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
