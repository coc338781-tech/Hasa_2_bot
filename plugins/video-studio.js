import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { GoogleGenerativeAI } from "@google/generative-ai";

const run = promisify(execFile);
const queue = [];
let active = false;
const MAX_INPUT_BYTES = 180 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 180 * 1024 * 1024;
const MAX_DURATION = 15 * 60;

const HELP = `🎬 *HASA VIDEO STUDIO*

වීඩියෝ එකකට Reply කරලා .vedit සමඟ Edit එක දෙන්න.

*එක Job එකකින් Edit කිහිපයක්:*
.vedit quality 1080 | speed 0.8 | caption අද මගේ ලස්සන දවස | filter cinematic
.vedit trim 00:05 00:25 | mute | format 9:16
.vedit text හෙලෝ HASA | textcolor yellow | fontsize 42
.vedit brightness 0.1 | contrast 1.2 | saturation 1.3
.vedit rotate 90 | flip h | volume 70
.vedit music URL | musicvolume 25
.vedit music remove
.vedit reverse
.vedit gif
.vedit extractaudio
.vedit help

*Options:*
quality 480|720|1080 | speed 0.25-4 | compress low/medium/high
caption <සිංහල/English> | text <text> | textposition top/middle/bottom
subtitle auto (Whisper model අවශ්‍යයි)\nvoiceover <සිංහල text> (Gemini TTS)
trim <start> <end> | mute | volume 0-200 | pitch 0.5-2
music <https URL>| music remove | musicvolume 0-100
format 9:16|16:9|1:1 | crop | rotate 90|180|270
flip h|v | brightness -1..1 | contrast 0..2
saturation 0..3 | filter cinematic|warm|bw|vintage|none
textcolor white|yellow|red|blue|green | fontsize 12-96
fps 24|25|30|50|60 | sharpen 0-2 | blur 0.1-20 | denoise 0-10
vignette on | sepia on | fadein 1 | fadeout 1
audiofadein 1 | audiofadeout 1 | normalize
reverse (වීඩියෝව විනාඩි 2ට අඩු විය යුතුයි) | thumbnail 00:05 | gif | extractaudio | auto

*වැදගත්:* එක් එක් Edit එක | ලකුණෙන් වෙන් කරන්න.
සිංහල අකුරු නිවැරදිව පෙන්වීමට Server එකේ Sinhala Unicode Font එකක් තිබිය යුතුයි.
වීඩියෝ සීමාව: විනාඩි 15 / 180MB. Server එකේ FFmpeg සහ FFprobe අවශ්‍යයි.`;

function bodyOf(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}

function quotedVideo(message) {
  const context = message.message?.extendedTextMessage?.contextInfo ||
    message.message?.imageMessage?.contextInfo ||
    message.message?.videoMessage?.contextInfo;
  const quoted = context?.quotedMessage;
  if (!quoted) return null;
  return quoted.videoMessage ||
    quoted.ephemeralMessage?.message?.videoMessage ||
    quoted.viewOnceMessage?.message?.videoMessage ||
    quoted.viewOnceMessageV2?.message?.videoMessage || null;
}

async function downloadMedia(media, type, destination, maxBytes = MAX_INPUT_BYTES) {
  const stream = await downloadContentFromMessage(media, type);
  let total = 0;
  const fd = fs.openSync(destination, "w", 0o600);
  try {
    for await (const chunk of stream) {
      total += chunk.length;
      if (total > maxBytes) throw new Error("ගොනුව " + Math.round(maxBytes / 1024 / 1024) + "MB සීමාව ඉක්මවයි.");
      fs.writeSync(fd, chunk);
    }
  } catch (error) {
    fs.rmSync(destination, { force: true });
    throw error;
  } finally {
    fs.closeSync(fd);
  }
  if (!total) throw new Error("WhatsApp වෙතින් වීඩියෝ දත්ත ලැබුණේ නැහැ.");
  return total;
}

export function parseOperations(raw) {
  return raw.split("|").map(part => part.trim()).filter(Boolean).map(part => {
    const match = part.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    return { name: (match?.[1] || "").toLowerCase(), value: (match?.[2] || "").trim() };
  });
}

export function parseTime(value) {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) throw new Error("Time එක 00:00 හෝ seconds ලෙස දෙන්න.");
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function safeNumber(value, min, max, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(label + " අගය " + min + " සිට " + max + " අතර විය යුතුයි.");
  }
  return number;
}

function escapeFilterPath(file) {
  return file.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function escapeDrawText(text) {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'")
    .replace(/%/g, "\\%").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

async function probe(file, maxDuration = MAX_DURATION) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height", "-of", "json", file], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  const data = JSON.parse(stdout);
  const duration = Number(data.format?.duration || 0);
  if (!duration || duration > maxDuration) throw new Error("වීඩියෝව හිස් හෝ " + Math.round(maxDuration / 60) + " විනාඩි සීමාව ඉක්මවා ඇත.");
  return { duration, streams: data.streams || [] };
}

export function buildPlan(operations, input, output, workDir, config, hasAudio, sourceDuration) {
  const filters = [];
  const audioFilters = [];
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input];
  let outputFormat = "mp4";
  let crf = 23;
  let thumbnailAt = null;
  let audioMode = "copy";
  let muteOriginal = false;
  let speed = 1;
  let trimStart = null, trimEnd = null;
  let reverse = false, gif = false, extractAudio = false;
  let musicPath = null;
  let voiceoverPath = null;
  let musicVolume = 0.25;
  let textColor = "white", fontSize = 36, textPosition = "bottom";
  let brightness = 0, contrast = 1, saturation = 1;
  let videoFadeIn = 0, videoFadeOut = 0, audioFadeIn = 0, audioFadeOut = 0;
  const captions = [];

  for (const op of operations) {
    const v = op.value;
    switch (op.name) {
      case "quality": {
        const height = safeNumber(v, 240, 1080, "Quality");
        if (![480, 720, 1080].includes(height)) throw new Error("Quality: 480, 720 හෝ 1080 භාවිතා කරන්න.");
        filters.push("scale=-2:" + height);
        break;
      }
      case "speed":
        speed = safeNumber(v, 0.25, 4, "Speed");
        filters.push("setpts=" + (1 / speed).toFixed(5) + "*PTS");
        let remaining = speed;
        while (remaining < 0.5) { audioFilters.push("atempo=0.5"); remaining /= 0.5; }
        while (remaining > 2) { audioFilters.push("atempo=2"); remaining /= 2; }
        audioFilters.push("atempo=" + remaining.toFixed(5));
        audioMode = "encode";
        break;
      case "trim": {
        const times = v.split(/\s+/);
        if (times.length !== 2) throw new Error("trim 00:05 00:25 ලෙස දෙන්න.");
        trimStart = parseTime(times[0]); trimEnd = parseTime(times[1]);
        if (trimEnd <= trimStart) throw new Error("Trim end එක start එකට වඩා පසුව තිබිය යුතුයි.");
        audioMode = "encode";
        break;
      }
      case "voiceoverfile":
        if (!v || !v.startsWith(workDir + path.sep) || !fs.existsSync(v)) throw new Error("Voice-over file එක හමු වුණේ නැහැ.");
        voiceoverPath = v;
        break;
      case "subtitlefile":
        if (!v || !v.startsWith(workDir + path.sep) || !fs.existsSync(v)) throw new Error("Subtitle file එක හමු වුණේ නැහැ.");
        filters.push("subtitles=filename='" + escapeFilterPath(v) + "':force_style='FontName=Noto Sans Sinhala,FontSize=22,Alignment=2,MarginV=40'");
        break;
      case "caption":
      case "text":
        if (!v) throw new Error("Caption/Text එක හිස්.");
        captions.push(v);
        break;
      case "textcolor":
        if (!["white", "yellow", "red", "blue", "green"].includes(v.toLowerCase())) throw new Error("Text color: white/yellow/red/blue/green.");
        textColor = v.toLowerCase();
        break;
      case "fontsize":
        fontSize = safeNumber(v, 12, 96, "Font size");
        break;
      case "textposition":
        if (!["top", "middle", "bottom"].includes(v)) throw new Error("textposition top/middle/bottom භාවිතා කරන්න.");
        textPosition = v;
        break;
      case "pitch": {
        const pitch = safeNumber(v, 0.5, 2, "Pitch");
        audioFilters.push("asetrate=44100*" + pitch + ",aresample=44100,atempo=" + (1 / pitch).toFixed(5));
        audioMode = "encode";
        break;
      }
      case "fps": {
        const fps = safeNumber(v, 12, 60, "FPS");
        if (![24, 25, 30, 50, 60].includes(fps)) throw new Error("FPS 24/25/30/50/60 භාවිතා කරන්න.");
        filters.push("fps=" + fps);
        break;
      }
      case "blur":
        filters.push("gblur=sigma=" + safeNumber(v, 0.1, 20, "Blur"));
        break;
      case "compress":
        if (v === "low") crf = 28;
        else if (v === "medium") crf = 23;
        else if (v === "high") crf = 18;
        else throw new Error("compress low/medium/high භාවිතා කරන්න.");
        break;
      case "normalize":
        audioFilters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
        audioMode = "encode";
        break;
      case "thumbnail":
        thumbnailAt = v ? parseTime(v) : 1;
        outputFormat = "jpg";
        break;
      case "sharpen":
        filters.push("unsharp=5:5:" + safeNumber(v, 0, 2, "Sharpen") + ":5:5:0");
        break;
      case "denoise":
        filters.push("hqdn3d=" + safeNumber(v, 0, 10, "Denoise"));
        break;
      case "vignette":
        if (!["on", "off"].includes(v)) throw new Error("vignette on/off භාවිතා කරන්න.");
        if (v === "on") filters.push("vignette");
        break;
      case "sepia":
        if (!["on", "off"].includes(v)) throw new Error("sepia on/off භාවිතා කරන්න.");
        if (v === "on") filters.push("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131");
        break;
      case "fadein":
        videoFadeIn = safeNumber(v, 0.1, 10, "Fade in");
        break;
      case "fadeout":
        videoFadeOut = safeNumber(v, 0.1, 10, "Fade out");
        break;
      case "audiofadein":
        audioFadeIn = safeNumber(v, 0.1, 10, "Audio fade in");
        audioMode = "encode";
        break;
      case "audiofadeout":
        audioFadeOut = safeNumber(v, 0.1, 10, "Audio fade out");
        audioMode = "encode";
        break;
      case "mute":
        muteOriginal = true;
        audioMode = "mute";
        break;
      case "volume":
        audioFilters.push("volume=" + (safeNumber(v, 0, 200, "Volume") / 100));
        audioMode = "encode";
        break;
      case "music":
        if (v.toLowerCase() === "remove" || v.toLowerCase() === "off") { musicPath = null; }
        else if (/^https:\/\//i.test(v) || v.startsWith(workDir + path.sep)) musicPath = v;
        else throw new Error("Music සඳහා HTTPS audio URL එකක් හෝ 'music remove' දෙන්න.");
        break;
      case "musicvolume":
        musicVolume = safeNumber(v, 0, 100, "Music volume") / 100;
        break;
      case "format":
        if (v === "9:16") filters.push("scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2");
        else if (v === "16:9") filters.push("scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2");
        else if (v === "1:1") filters.push("scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2");
        else throw new Error("format 9:16, 16:9 හෝ 1:1 භාවිතා කරන්න.");
        break;
      case "crop":
        filters.push("crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'");
        break;
      case "rotate":
        if (v === "90") filters.push("transpose=1");
        else if (v === "270") filters.push("transpose=2");
        else if (v === "180") filters.push("hflip,vflip");
        else throw new Error("rotate 90, 180 හෝ 270 භාවිතා කරන්න.");
        break;
      case "flip":
        if (v === "h") filters.push("hflip");
        else if (v === "v") filters.push("vflip");
        else throw new Error("flip h හෝ flip v භාවිතා කරන්න.");
        break;
      case "brightness":
        brightness = safeNumber(v, -1, 1, "Brightness");
        break;
      case "contrast":
        contrast = safeNumber(v, 0, 2, "Contrast");
        break;
      case "saturation":
        saturation = safeNumber(v, 0, 3, "Saturation");
        break;
      case "filter":
        if (v === "cinematic") { contrast = 1.15; saturation = 1.2; brightness = -0.02; filters.push("colorbalance=rs=0.04:bs=-0.04"); }
        else if (v === "warm") filters.push("colorbalance=rs=0.12:gs=0.03:bs=-0.12");
        else if (v === "bw") saturation = 0;
        else if (v === "vintage") { saturation = 0.8; filters.push("curves=vintage"); }
        else if (v === "none") { brightness = 0; contrast = 1; saturation = 1; }
        else throw new Error("filter cinematic/warm/bw/vintage/none භාවිතා කරන්න.");
        break;
      case "reverse":
        reverse = true; audioMode = "encode";
        break;
      case "gif":
        gif = true; outputFormat = "gif";
        break;
      case "extractaudio":
        extractAudio = true; outputFormat = "mp3";
        break;
      default:
        throw new Error("නොදන්නා Edit Option එකක්: " + op.name + ". .vedit help බලන්න.");
    }
  }

  if (gif && extractAudio) throw new Error("GIF සහ MP3 export එකම Job එකක කළ නොහැක. වෙන වෙනම Job දෙකක් කරන්න.");
  if (thumbnailAt !== null) {
    if (operations.length !== 1) throw new Error("Thumbnail export එක වෙනත් edits සමඟ එකම Job එකක කළ නොහැක. .vedit thumbnail 00:05 ලෙස වෙනම කරන්න.");
    return { args: ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(thumbnailAt), "-i", input, "-frames:v", "1", "-q:v", "2", output], outputFormat };
  }
  if (brightness !== 0 || contrast !== 1 || saturation !== 1) filters.push("eq=brightness=" + brightness + ":contrast=" + contrast + ":saturation=" + saturation);
  const effectiveDuration = Math.max(0, (trimEnd !== null ? trimEnd - (trimStart || 0) : sourceDuration) / speed);
  if (videoFadeIn) filters.push("fade=t=in:st=0:d=" + videoFadeIn);
  if (videoFadeOut && effectiveDuration > videoFadeOut) filters.push("fade=t=out:st=" + (effectiveDuration - videoFadeOut) + ":d=" + videoFadeOut);
  if (audioFadeIn) audioFilters.push("afade=t=in:st=0:d=" + audioFadeIn);
  if (audioFadeOut && effectiveDuration > audioFadeOut) audioFilters.push("afade=t=out:st=" + (effectiveDuration - audioFadeOut) + ":d=" + audioFadeOut);

  if (extractAudio) {
    if (trimStart !== null) args.splice(4, 0, "-ss", String(trimStart));
    if (trimEnd !== null) args.push("-t", String(trimEnd - trimStart));
    if (muteOriginal) throw new Error("Mute සහ MP3 extraction එක එකම Job එකක කළ නොහැක.");
    if (!hasAudio) throw new Error("මේ වීඩියෝ එකේ Audio track එකක් නැහැ.");
    args.push("-vn");
    if (audioFilters.length) args.push("-af", audioFilters.join(","));
    args.push("-codec:a", "libmp3lame", "-q:a", "3", output);
    return { args, outputFormat };
  }

  if (reverse && sourceDuration > 120) throw new Error("Reverse Effect එක සඳහා වීඩියෝව විනාඩි 2කට අඩු විය යුතුයි.");
  if (reverse) {
    filters.push("reverse");
    audioFilters.push("areverse");
  }

  for (let i = 0; i < captions.length; i++) {
    const textFile = path.join(workDir, "caption-" + i + ".txt");
    fs.writeFileSync(textFile, captions[i], { encoding: "utf8", mode: 0o600 });
    const font = config.videoStudio?.fontFile || "/usr/share/fonts/truetype/noto/NotoSansSinhala-Regular.ttf";
    const fontPart = fs.existsSync(font) ? "fontfile='" + escapeFilterPath(font) + "':" : "";
    const color = textColor;
    const size = fontSize;
    const textfile = escapeFilterPath(textFile);
    const y = textPosition === "top" ? "50" : textPosition === "middle" ? "(h-text_h)/2" : "h-text_h-50";
    filters.push("drawtext=" + fontPart + "textfile='" + textfile + "':fontcolor=" + color + ":fontsize=" + size + ":borderw=2:bordercolor=black:x=(w-text_w)/2:y=" + y);
  }

  if (trimStart !== null) args.splice(4, 0, "-ss", String(trimStart));
  if (trimEnd !== null) args.push("-t", String(trimEnd - trimStart));
  if (voiceoverPath && musicPath) throw new Error("Voice-over සහ Music file එකම Job එකක දැනට එකතු කළ නොහැක.");
  if (!gif && filters.length) args.push("-vf", filters.join(","));
  if (gif) {
    args.push("-an", "-vf", [...filters, "fps=12,scale=480:-1:flags=lanczos"].join(","));
  } else if (voiceoverPath) {
    args.push("-i", voiceoverPath);
    if (hasAudio && !muteOriginal) {
      const sourceFilters = audioFilters.length ? audioFilters.join(",") + "," : "";
      args.push("-filter_complex", "[0:a]" + sourceFilters + "anull[original];[1:a]apad=whole_dur=" + effectiveDuration + "[voice];[original][voice]amix=inputs=2:duration=first:dropout_transition=1[aout]", "-map", "0:v:0", "-map", "[aout]");
    } else {
      args.push("-filter_complex", "[1:a]apad=whole_dur=" + effectiveDuration + "[voice]", "-map", "0:v:0", "-map", "[voice]");
    }
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-c:a", "aac");
  } else if (musicPath) {
    args.push("-stream_loop", "-1", "-i", musicPath);
    if (hasAudio && !muteOriginal) {
      const sourceFilters = audioFilters.length ? audioFilters.join(",") + "," : "";
      args.push("-filter_complex", "[0:a]" + sourceFilters + "anull[original];[1:a]volume=" + musicVolume + "[music];[original][music]amix=inputs=2:duration=first:dropout_transition=2[aout]", "-map", "0:v:0", "-map", "[aout]");
    } else args.push("-map", "0:v:0", "-map", "1:a:0", "-af", "volume=" + musicVolume);
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-c:a", "aac", "-shortest");
  } else if (muteOriginal) {
    args.push("-an");
  } else if (audioFilters.length) {
    args.push("-af", audioFilters.join(","), "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-c:a", "aac");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-c:a", "aac");
  }
  if (gif) args.push("-loop", "0");
  else if (outputFormat === "mp4") args.push("-movflags", "+faststart");
  args.push(output);
  return { args, outputFormat };
}

async function downloadMusic(url, destination) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Music URL එක HTTPS විය යුතුයි.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error("Music URL එකෙන් audio ලබාගන්න බැරි වුණා (" + response.status + ").");
    const type = response.headers.get("content-type") || "";
    if (!type.startsWith("audio/") && !/octet-stream/i.test(type)) throw new Error("URL එක audio file එකක් නොවේ.");
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 30 * 1024 * 1024) throw new Error("Music file එක 30MB ඉක්මවයි.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new Error("Music file එක හිස් හෝ 30MB ඉක්මවයි.");
    fs.writeFileSync(destination, buffer, { mode: 0o600 });
  } finally {
    clearTimeout(timeout);
  }
}


async function getAiAutoEdit(input, workDir, config) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI Auto Edit සඳහා .env තුළ GEMINI_API_KEY සකසන්න.");
  const contactSheet = path.join(workDir, "video-contact-sheet.jpg");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", "fps=1/3,scale=320:-1,tile=3x3", "-frames:v", "1", "-q:v", "4", contactSheet], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  if (!fs.existsSync(contactSheet)) throw new Error("AI analysis සඳහා Video preview එකක් සකස් කළ නොහැක.");
  const imageData = fs.readFileSync(contactSheet).toString("base64");
  const ai = new GoogleGenerativeAI(apiKey);
  const model = ai.getGenerativeModel({
    model: config.videoStudio?.aiModel || config.aiModel || "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json" }
  });
  const prompt = `Analyze this 3x3 contact sheet sampled from a user-provided video. Recommend a conservative, tasteful edit using ONLY the allowed options. Return JSON only with keys: brightness (-0.1..0.1), contrast (0.9..1.2), saturation (0.8..1.3), speed (0.8..1.2), filter ("none"|"cinematic"|"warm"|"bw"|"vintage"), format ("original"|"9:16"|"16:9"|"1:1"), caption (short Sinhala caption, maximum 70 characters). Do not invent events, people, identities, audio, dialogue, or facts. Prefer format "original" unless vertical social video is clearly appropriate. Do not include markdown.`;
  const result = await model.generateContent([
    { inlineData: { mimeType: "image/jpeg", data: imageData } },
    prompt
  ]);
  let parsed;
  try {
    parsed = JSON.parse(result.response.text());
  } catch {
    throw new Error("AI Auto Edit වෙතින් වලංගු edit plan එකක් ලැබුණේ නැහැ.");
  }
  const brightness = Number(parsed.brightness);
  const contrast = Number(parsed.contrast);
  const saturation = Number(parsed.saturation);
  const speed = Number(parsed.speed);
  if (!Number.isFinite(brightness) || brightness < -0.1 || brightness > 0.1 ||
      !Number.isFinite(contrast) || contrast < 0.9 || contrast > 1.2 ||
      !Number.isFinite(saturation) || saturation < 0.8 || saturation > 1.3 ||
      !Number.isFinite(speed) || speed < 0.8 || speed > 1.2) {
    throw new Error("AI Auto Edit එකෙන් ලැබුණු අගයන් ආරක්ෂිත සීමාවෙන් පිටතයි.");
  }
  const allowedFilters = ["none", "cinematic", "warm", "bw", "vintage"];
  const allowedFormats = ["original", "9:16", "16:9", "1:1"];
  if (!allowedFilters.includes(parsed.filter) || !allowedFormats.includes(parsed.format)) {
    throw new Error("AI Auto Edit එකෙන් නොදන්නා Filter හෝ Format එකක් ලැබුණා.");
  }
  const generated = [
    { name: "filter", value: parsed.filter },
    { name: "brightness", value: String(brightness) },
    { name: "contrast", value: String(contrast) },
    { name: "saturation", value: String(saturation) },
    { name: "speed", value: String(speed) }
  ];
  if (parsed.format !== "original") generated.push({ name: "format", value: parsed.format });
  if (typeof parsed.caption === "string" && parsed.caption.trim()) {
    generated.push({ name: "caption", value: parsed.caption.trim().slice(0, 70) });
  }
  return generated;
}


async function generateVoiceover(text, destination, config) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI Voice Over සඳහා .env තුළ GEMINI_API_KEY සකසන්න.");
  if (!text || text.length > 1200) throw new Error("Voice-over Text එක අක්ෂර 1,200කට අඩු විය යුතුයි.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(config.videoStudio?.ttsModel || "gemini-3.8-flash-tts") +
      ":generateContent", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            languageCode: config.videoStudio?.ttsLanguage || "si-LK",
            voiceConfig: { prebuiltVoiceConfig: { voiceName: config.videoStudio?.ttsVoice || "Kore" } }
          }
        }
      }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini TTS request failed (" + response.status + ").");
    const audio = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData?.data;
    if (!audio) throw new Error("Gemini TTS වෙතින් Audio එකක් ලැබුණේ නැහැ.");
    fs.writeFileSync(destination, Buffer.from(audio, "base64"), { mode: 0o600 });
  } finally {
    clearTimeout(timeout);
  }
}

async function processJob(job) {
  const { sock, jid, message, video, config } = job;
  let operations = job.operations;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-video-"));
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, operations.some(x => x.name === "gif") ? "output.gif" : operations.some(x => x.name === "extractaudio") ? "output.mp3" : operations.some(x => x.name === "thumbnail") ? "thumbnail.jpg" : "output.mp4");
  try {
    await sock.sendMessage(jid, { text: "⏳ *HASA VIDEO STUDIO*\nVideo එක Download කරලා Edit කරන්න සූදානම් කරනවා..." }, { quoted: message });
    await downloadMedia(video, "video", input, config.videoStudio?.maxInputBytes || MAX_INPUT_BYTES);
    const info = await probe(input, config.videoStudio?.maxDurationSeconds || MAX_DURATION);
    if (!info.streams.some(s => s.codec_type === "video")) throw new Error("Video track එකක් හමු වුණේ නැහැ.");
    const voiceover = operations.find(x => x.name === "voiceover");
    if (voiceover) {
      const voiceoverFile = path.join(dir, "voiceover.wav");
      await generateVoiceover(voiceover.value, voiceoverFile, config);
      operations = operations.filter(x => x.name !== "voiceover");
      operations.push({ name: "voiceoverfile", value: voiceoverFile });
    }
    const autoSubtitle = operations.filter(x => x.name === "subtitle" && x.value.toLowerCase() === "auto");
    if (autoSubtitle.length) {
      const model = config.videoStudio?.whisperModel;
      if (!model || !fs.existsSync(model)) throw new Error("Auto Sinhala Subtitle සඳහා whisper.cpp model එකක් අවශ්‍යයි. config.json තුළ videoStudio.whisperModel සකසන්න.");
      if (!info.streams.some(s => s.codec_type === "audio")) throw new Error("මේ වීඩියෝවේ කථන Audio track එකක් නැහැ.");
      if (info.duration > 300) throw new Error("Auto Subtitle සඳහා දැනට වීඩියෝව විනාඩි 5කට අඩු විය යුතුයි.");
      const wav = path.join(dir, "speech.wav");
      const subtitleBase = path.join(dir, "generated-captions");
      await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      await run(config.videoStudio?.whisperBinary || "whisper-cli", ["-m", model, "-f", wav, "-l", config.videoStudio?.whisperLanguage || "si", "-t", String(config.videoStudio?.whisperThreads || 2), "-osrt", "-of", subtitleBase], { timeout: 8 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
      const subtitleFile = subtitleBase + ".srt";
      if (!fs.existsSync(subtitleFile) || !fs.statSync(subtitleFile).size) throw new Error("Whisper මඟින් Subtitle file එකක් නිර්මාණය වුණේ නැහැ.");
      operations = operations.filter(x => !(x.name === "subtitle" && x.value.toLowerCase() === "auto"));
      operations.push({ name: "subtitlefile", value: subtitleFile });
    }
    if (operations.some(x => x.name === "auto")) {
      const generated = await getAiAutoEdit(input, dir, config);
      operations = [...generated, ...operations.filter(x => x.name !== "auto")];
    }
    const music = operations.find(x => x.name === "music" && /^https:\/\//i.test(x.value));
    if (music) {
      const musicFile = path.join(dir, "music-audio");
      await downloadMusic(music.value, musicFile);
      operations = operations.map(x => x.name === "music" ? { ...x, value: musicFile } : x);
    }
    const plan = buildPlan(operations, input, output, dir, config, info.streams.some(s => s.codec_type === "audio"), info.duration);
    await run("ffmpeg", plan.args, { timeout: 8 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
    const stat = fs.statSync(output);
    if (!stat.size || stat.size > MAX_OUTPUT_BYTES) throw new Error("Edited file එක හිස් හෝ 180MB සීමාව ඉක්මවා ඇත.");
    const mediaStream = fs.createReadStream(output);
    const caption = "✅ *HASA VIDEO STUDIO — EDIT COMPLETED*\n" +
      "🎬 " + operations.map(x => x.name).join(" + ") + "\n" +
      "⏱️ " + info.duration.toFixed(1) + "s";
    if (plan.outputFormat === "mp3") {
      await sock.sendMessage(jid, { audio: mediaStream, mimetype: "audio/mpeg", fileName: "Hasa_Audio.mp3", caption }, { quoted: message });
    } else if (plan.outputFormat === "jpg") {
      await sock.sendMessage(jid, { image: mediaStream, caption: "🖼️ *HASA VIDEO STUDIO — THUMBNAIL READY*" }, { quoted: message });
    } else if (plan.outputFormat === "gif") {
      await sock.sendMessage(jid, { video: mediaStream, gifPlayback: true, caption }, { quoted: message });
    } else {
      await sock.sendMessage(jid, { video: mediaStream, mimetype: "video/mp4", fileName: "Hasa_Edited.mp4", caption }, { quoted: message });
    }
  } catch (error) {
    console.error("[HASA VIDEO STUDIO]", error);
    await sock.sendMessage(jid, { text: "❌ *Video Edit අසාර්ථකයි*\n" + (error.message || "Unknown error") + "\n\n.vhelp බලන්න." }, { quoted: message }).catch(() => {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function drainQueue() {
  if (active) return;
  active = true;
  while (queue.length) {
    const job = queue.shift();
    await processJob(job);
  }
  active = false;
}

export default async function videoStudio({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const body = bodyOf(message).trim();
  const prefix = config.prefix || ".";
  if (!body.startsWith(prefix)) return;
  const [command, ...rest] = body.slice(prefix.length).trim().split(/\s+/);
  if (!["vedit", "vhelp", "videohelp"].includes((command || "").toLowerCase())) return;
  const argText = body.slice(prefix.length).trim().replace(/^\S+\s*/, "");
  if (config.videoStudio?.enabled === false) return sock.sendMessage(jid, { text: "⛔ HASA VIDEO STUDIO දැනට අක්‍රිය කර ඇත." }, { quoted: message });
  if (!argText || /^help$/i.test(argText)) {
    return sock.sendMessage(jid, { text: HELP }, { quoted: message });
  }
  if (!message.key?.fromMe && config.videoStudio?.ownerOnly !== false) {
    const sender = message.key.participant || jid;
    const number = String(sender).split("@")[0].split(":")[0].replace(/\D/g, "");
    const isOwner = (config.owner || []).some(item => String(item).replace(/\D/g, "") === number);
    if (!isOwner) return sock.sendMessage(jid, { text: "⛔ Video Studio භාවිතා කළ හැක්කේ Bot Ownerට පමණයි." }, { quoted: message });
  }
  const video = quotedVideo(message);
  if (!video) return sock.sendMessage(jid, { text: "❌ Edit කරන්න ඕනෑ Video එකට Reply කරලා .vedit යවන්න.\n\n.vhelp" }, { quoted: message });
  const operations = parseOperations(argText);
  if (!operations.length) return sock.sendMessage(jid, { text: HELP }, { quoted: message });
  if (queue.length >= 3) return sock.sendMessage(jid, { text: "⏳ Video Edit queue එක පිරී ඇත. ටිකකින් නැවත උත්සාහ කරන්න." }, { quoted: message });
  queue.push({ sock, jid, message, video, operations, config });
  const position = queue.length + (active ? 1 : 0);
  await sock.sendMessage(jid, { text: "📥 *HASA VIDEO STUDIO*\nඔබේ Edit Job එක Queue එකට එකතු කළා.\n📌 Queue position: " + position }, { quoted: message });
  void drainQueue();
}
