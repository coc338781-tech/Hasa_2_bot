import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getAiAutoEdit, generateVoiceover, generateWhisperSubtitles } from "../plugins/video-studio.js";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("BLOCKED: GEMINI_API_KEY is missing from GitHub Actions secrets. Configure the repository secret to run real Gemini 3.8 Flash and TTS API checks.");
  process.exit(1);
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
      fontFile: "/usr/share/fonts/truetype/noto/NotoSansSinhala-Regular.ttf",
      whisperBinary: process.env.WHISPER_BINARY || "whisper-cli",
      whisperModel: process.env.WHISPER_MODEL || "",
      whisperLanguage: "si",
      whisperThreads: 2
    }
  };

  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video
  ], { stdio: "pipe" });

  const failures = [];
  console.log("TEST 1/3: Gemini 3.8 Flash visual auto-edit request...");
  try {
    const plan = await getAiAutoEdit(video, dir, config);
    if (!Array.isArray(plan) || !plan.some(x => x.name === "filter") || !plan.some(x => x.name === "speed")) {
      throw new Error("Gemini Flash returned an incomplete or invalid edit plan.");
    }
    console.log("PASS: Gemini 3.8 Flash returned a validated edit plan (" + plan.map(x => x.name).join(", ") + ").");
  } catch (error) {
    failures.push("Gemini Flash visual auto-edit: " + (error.message || error));
    console.error("FAIL: " + failures[failures.length - 1]);
  }

  console.log("TEST 2/3: Gemini 3.8 Flash TTS Sinhala voice generation...");
  try {
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
  } catch (error) {
    failures.push("Gemini Sinhala TTS: " + (error.message || error));
    console.error("FAIL: " + failures[failures.length - 1]);
  }

  console.log("TEST 3/3: Whisper.cpp Sinhala speech-to-text subtitles...");
  try {
    if (!config.videoStudio.whisperModel || !fs.existsSync(config.videoStudio.whisperModel)) {
      throw new Error("WHISPER_MODEL is missing or does not exist.");
    }
    const speechVideo = path.join(dir, "sinhala-speech-video.mp4");
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", video, "-i", voice,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "aac", "-shortest", speechVideo
    ], { stdio: "pipe" });
    const subtitleFile = await generateWhisperSubtitles(speechVideo, dir, config);
    const subtitles = fs.readFileSync(subtitleFile, "utf8");
    if (!subtitles.trim() || !/\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(subtitles)) {
      throw new Error("Whisper did not produce a valid timed SRT subtitle file.");
    }
    console.log("PASS: Whisper.cpp generated Sinhala SRT subtitles (" + fs.statSync(subtitleFile).size + " bytes).");
  } catch (error) {
    failures.push("Whisper Sinhala subtitles: " + (error.message || error));
    console.error("FAIL: " + failures[failures.length - 1]);
  }

  if (failures.length) throw new Error("VIDEO STUDIO LIVE SMOKE TEST FAILED: " + failures.join(" | "));
  console.log("VIDEO STUDIO LIVE SMOKE TEST PASSED.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
