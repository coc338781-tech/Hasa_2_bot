import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const exec = promisify(execFile);
const MAX_INPUT = 25 * 1024 * 1024;

function messageBody(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}

function getQuotedContent(message) {
  const context = message.message?.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage || {};
  const candidates = [
    ["imageMessage", quoted.imageMessage],
    ["videoMessage", quoted.videoMessage],
    ["stickerMessage", quoted.stickerMessage],
    ["audioMessage", quoted.audioMessage],
    ["imageMessage", message.message?.imageMessage],
    ["videoMessage", message.message?.videoMessage],
    ["stickerMessage", message.message?.stickerMessage],
    ["audioMessage", message.message?.audioMessage]
  ];
  return candidates.find(([, value]) => value)?.[0]
    ? candidates.find(([, value]) => value)
    : [null, null];
}

async function downloadMedia(media, kind) {
  const stream = await downloadContentFromMessage(media, kind);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_INPUT) throw new Error("Media එක 25 MB සීමාව ඉක්මවා ඇත.");
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error("Media data ලබාගත නොහැක.");
  return buffer;
}

function mediaKind(type) {
  return type === "imageMessage" ? "image" :
    type === "videoMessage" ? "video" :
    type === "stickerMessage" ? "sticker" :
    type === "audioMessage" ? "audio" : null;
}

export default async function mediaTools({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const prefix = config.prefix || ".";
  const body = messageBody(message).trim();
  if (!body.startsWith(prefix)) return;
  const [rawCommand] = body.slice(prefix.length).trim().split(/\s+/);
  const command = (rawCommand || "").toLowerCase();
  if (!["sticker", "toaudio", "toimage"].includes(command)) return;

  const send = text => sock.sendMessage(jid, { text }, { quoted: message });
  const [type, media] = getQuotedContent(message);
  if (!media) {
    return send(
      "╭─〔 🎞️ *HASA MEDIA TOOLS* 〕\n" +
      "│ .sticker — Image/Video එකකට Reply කරන්න\n" +
      "│ .toaudio — Video එකකට Reply කරන්න\n" +
      "│ .toimage — Sticker එකකට Reply කරන්න\n" +
      "╰────────────────"
    );
  }

  const kind = mediaKind(type);
  const allowed = command === "sticker"
    ? ["image", "video"]
    : command === "toaudio"
      ? ["video", "audio"]
      : ["sticker"];
  if (!allowed.includes(kind)) {
    return send(command === "sticker"
      ? "Image එකකට හෝ Video එකකට Reply කර .sticker යවන්න."
      : command === "toaudio"
        ? "Video/Audio එකකට Reply කර .toaudio යවන්න."
        : "Sticker එකකට Reply කර .toimage යවන්න.");
  }

  const tempDir = path.resolve("./tmp/media-tools");
  fs.mkdirSync(tempDir, { recursive: true });
  const id = randomUUID();
  const input = path.join(tempDir, id + (kind === "image" ? ".jpg" : kind === "video" ? ".mp4" : kind === "audio" ? ".ogg" : ".webp"));
  const output = path.join(tempDir, id + (command === "sticker" ? ".webp" : command === "toaudio" ? ".mp3" : ".jpg"));

  try {
    await send("⏳ *Media එක සූදානම් කරමින් පවතී...* පොඩ්ඩක් රැඳී සිටින්න.");
    const data = await downloadMedia(media, kind);
    fs.writeFileSync(input, data);

    if (command === "sticker") {
      const video = kind === "video";
      const args = [
        "-y", "-i", input,
        ...(video ? ["-t", "8", "-vf", "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000"] :
          ["-frames:v", "1", "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000"]),
        "-vcodec", "libwebp", "-lossless", video ? "0" : "1", "-q:v", "65", "-loop", "0", "-an", output
      ];
      await exec("ffmpeg", args, { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
      const sticker = fs.readFileSync(output);
      if (!sticker.length || sticker.length > 1024 * 1024) throw new Error("Sticker එක 1 MB සීමාව තුළ සකස් කළ නොහැකි වුණා.");
      await sock.sendMessage(jid, { sticker }, { quoted: message });
    } else if (command === "toaudio") {
      await exec("ffmpeg", ["-y", "-i", input, "-vn", "-b:a", "128k", "-ar", "44100", output], {
        timeout: 90000, maxBuffer: 2 * 1024 * 1024
      });
      const audio = fs.readFileSync(output);
      if (!audio.length || audio.length > 16 * 1024 * 1024) throw new Error("Audio file එක WhatsApp සීමාව ඉක්මවා ඇත.");
      await sock.sendMessage(jid, { audio, mimetype: "audio/mpeg", fileName: "hasa-audio.mp3" }, { quoted: message });
    } else {
      await exec("ffmpeg", ["-y", "-i", input, "-frames:v", "1", "-q:v", "2", output], {
        timeout: 30000, maxBuffer: 2 * 1024 * 1024
      });
      const image = fs.readFileSync(output);
      if (!image.length || image.length > 8 * 1024 * 1024) throw new Error("Image එක WhatsApp සීමාව ඉක්මවා ඇත.");
      await sock.sendMessage(jid, { image, caption: "🖼️ *Sticker converted to image*" }, { quoted: message });
    }
  } catch (error) {
    console.error("Media tool failed:", error.stack || error.message);
    const missingTool = error.code === "ENOENT";
    await send(missingTool
      ? "❌ FFmpeg හමු වුණේ නැහැ. Server එකේ FFmpeg ස්ථාපනය කළ යුතුයි."
      : "❌ Media එක සකස් කරන්න බැරි වුණා. වෙනත් Image/Video එකක් උත්සාහ කරන්න. (" + String(error.message || error).slice(0, 120) + ")");
  } finally {
    for (const file of [input, output]) {
      try { fs.unlinkSync(file); } catch {}
    }
  }
}
