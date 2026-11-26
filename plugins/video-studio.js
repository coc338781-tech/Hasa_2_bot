import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

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
quality 480|720|1080 | speed 0.25-4
caption <සිංහල/English> | text <text>
trim <start> <end> | mute | volume 0-200
music <https URL>| music remove | musicvolume 0-100
format 9:16|16:9|1:1 | crop | rotate 90|180|270
flip h|v | brightness -1..1 | contrast 0..2
saturation 0..3 | filter cinematic|warm|bw|vintage|none
textcolor white|yellow|red|blue|green | fontsize 12-96
reverse | gif | extractaudio

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

async function downloadMedia(media, type, destination) {
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) throw new Error("ගොනුව 180MB සීමාව ඉක්මවයි.");
    chunks.push(chunk);
  }
  if (!total) throw new Error("WhatsApp වෙතින් වීඩියෝ දත්ත ලැබුණේ නැහැ.");
  fs.writeFileSync(destination, Buffer.concat(chunks), { mode: 0o600 });
  return total;
}

function parseOperations(raw) {
  return raw.split("|").map(part => part.trim()).filter(Boolean).map(part => {
    const match = part.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    return { name: (match?.[1] || "").toLowerCase(), value: (match?.[2] || "").trim() };
  });
}

function parseTime(value) {
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

async function probe(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height", "-of", "json", file], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  const data = JSON.parse(stdout);
  const duration = Number(data.format?.duration || 0);
  if (!duration || duration > MAX_DURATION) throw new Error("වීඩියෝව හිස් හෝ විනාඩි 15 සීමාව ඉක්මවා ඇත.");
  return { duration, streams: data.streams || [] };
}

function buildPlan(operations, input, output, workDir, config) {
  const filters = [];
  const audioFilters = [];
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input];
  let outputFormat = "mp4";
  let audioMode = "copy";
  let speed = 1;
  let trimStart = null, trimEnd = null;
  let reverse = false, gif = false, extractAudio = false;
  let musicPath = null;
  let musicVolume = 0.25;
  let textColor = "white", fontSize = 36;
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
        audioFilters.push("atempo=" + speed);
        audioMode = "encode";
        break;
      case "trim": {
        const times = v.split(/\s+/);
        if (times.length !== 2) throw new Error("trim 00:05 00:25 ලෙස දෙන්න.");
        trimStart = parseTime(times[0]); trimEnd = parseTime(times[1]);
        if (trimEnd <= trimStart) throw new Error("Trim end එක start එකට වඩා පසුව තිබිය යුතුයි.");
        args.push("-ss", String(trimStart), "-to", String(trimEnd));
        audioMode = "encode";
        break;
      }
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
      case "mute":
        audioMode = "mute";
        break;
      case "volume":
        audioFilters.push("volume=" + (safeNumber(v, 0, 200, "Volume") / 100));
        audioMode = "encode";
        break;
      case "music":
        if (v.toLowerCase() === "remove" || v.toLowerCase() === "off") audioMode = "mute";
        else if (/^https:\/\//i.test(v) || fs.existsSync(v)) musicPath = v;
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
        filters.push("eq=brightness=" + safeNumber(v, -1, 1, "Brightness"));
        break;
      case "contrast":
        filters.push("eq=contrast=" + safeNumber(v, 0, 2, "Contrast"));
        break;
      case "saturation":
        filters.push("eq=saturation=" + safeNumber(v, 0, 3, "Saturation"));
        break;
      case "filter":
        if (v === "cinematic") filters.push("eq=contrast=1.15:saturation=1.2:brightness=-0.02,colorbalance=rs=0.04:bs=-0.04");
        else if (v === "warm") filters.push("colorbalance=rs=0.12:gs=0.03:bs=-0.12");
        else if (v === "bw") filters.push("hue=s=0");
        else if (v === "vintage") filters.push("curves=vintage,eq=saturation=0.8");
        else if (v !== "none") throw new Error("filter cinematic/warm/bw/vintage/none භාවිතා කරන්න.");
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

  if (extractAudio) {
    return { args: ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-codec:a", "libmp3lame", "-q:a", "3", output], outputFormat };
  }

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
    filters.push("drawtext=" + fontPart + "textfile='" + textfile + "':fontcolor=" + color + ":fontsize=" + size + ":borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-text_h-50");
  }

  if (filters.length) args.push("-vf", filters.join(","));
  if (gif) {
    args.push("-an", "-vf", [...filters, "fps=12,scale=480:-1:flags=lanczos"].join(","));
  } else if (audioMode === "mute") {
    args.push("-an");
  } else if (musicPath) {
    args.push("-i", musicPath, "-filter_complex", "[1:a]volume=" + musicVolume + "[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]", "-map", "0:v:0", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-shortest");
  } else if (audioFilters.length) {
    args.push("-af", audioFilters.join(","), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac");
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
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 30 * 1024 * 1024) throw new Error("Music file එක හිස් හෝ 30MB ඉක්මවයි.");
    fs.writeFileSync(destination, buffer, { mode: 0o600 });
  } finally {
    clearTimeout(timeout);
  }
}

async function processJob(job) {
  const { sock, jid, message, video, config } = job;\n  let operations = job.operations;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-video-"));
  const input = path.join(dir, "input.mp4");
  const output = path.join(dir, operations.some(x => x.name === "gif") ? "output.gif" : operations.some(x => x.name === "extractaudio") ? "output.mp3" : "output.mp4");
  try {
    await sock.sendMessage(jid, { text: "⏳ *HASA VIDEO STUDIO*\nVideo එක Download කරලා Edit කරන්න සූදානම් කරනවා..." }, { quoted: message });
    await downloadMedia(video, "video", input);
    const info = await probe(input);
    if (!info.streams.some(s => s.codec_type === "video")) throw new Error("Video track එකක් හමු වුණේ නැහැ.");
    const music = operations.find(x => x.name === "music" && /^https:\/\//i.test(x.value));
    if (music) {
      const musicFile = path.join(dir, "music-audio");
      await downloadMusic(music.value, musicFile);
      operations = operations.map(x => x.name === "music" ? { ...x, value: musicFile } : x);
    }
    const plan = buildPlan(operations, input, output, dir, config);
    await run("ffmpeg", plan.args, { timeout: 8 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
    const stat = fs.statSync(output);
    if (!stat.size || stat.size > MAX_OUTPUT_BYTES) throw new Error("Edited file එක හිස් හෝ 180MB සීමාව ඉක්මවා ඇත.");
    const buffer = fs.readFileSync(output);
    const caption = "✅ *HASA VIDEO STUDIO — EDIT COMPLETED*\n" +
      "🎬 " + operations.map(x => x.name).join(" + ") + "\n" +
      "⏱️ " + info.duration.toFixed(1) + "s";
    if (plan.outputFormat === "mp3") {
      await sock.sendMessage(jid, { audio: buffer, mimetype: "audio/mpeg", fileName: "Hasa_Audio.mp3", caption }, { quoted: message });
    } else if (plan.outputFormat === "gif") {
      await sock.sendMessage(jid, { video: buffer, gifPlayback: true, caption }, { quoted: message });
    } else {
      await sock.sendMessage(jid, { video: buffer, mimetype: "video/mp4", fileName: "Hasa_Edited.mp4", caption }, { quoted: message });
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
