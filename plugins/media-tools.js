import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadContentFromMessage, normalizeMessageContent } from "@whiskeysockets/baileys";

const exec = promisify(execFile);
const MAX_INPUT = 64 * 1024 * 1024;

export const commands = [
  {
    name: "vv",
    category: "3",
    usage: "vv (reply to View Once photo/video)",
    description: "Save View Once media as a normal photo or video"
  }
];

function unwrapMessageContent(content) {
  let current = normalizeMessageContent(content) || content || {};
  for (let depth = 0; depth < 5; depth++) {
    const nested = current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;
    if (!nested) break;
    current = normalizeMessageContent(nested) || nested;
  }
  return current;
}

function isViewOnceContent(content, depth = 0) {
  if (!content || depth > 5) return false;
  if (content.viewOnceMessage || content.viewOnceMessageV2 || content.viewOnceMessageV2Extension) return true;
  if (content.imageMessage?.viewOnce || content.videoMessage?.viewOnce) return true;
  if (content.ephemeralMessage?.message) return isViewOnceContent(content.ephemeralMessage.message, depth + 1);
  return false;
}

function extractViewOnceMedia(content) {
  if (!content || !isViewOnceContent(content)) return null;
  const normalized = unwrapMessageContent(content);
  if (normalized.imageMessage) return { media: normalized.imageMessage, kind: "image" };
  if (normalized.videoMessage) return { media: normalized.videoMessage, kind: "video" };
  return null;
}

function hasDownloadLocation(media) {
  return Boolean(media?.url || media?.directPath);
}

export function findQuotedViewOnceMedia(message, cache) {
  const context = message.message?.extendedTextMessage?.contextInfo;
  const quoted = context?.quotedMessage;
  const quotedFound = extractViewOnceMedia(quoted);
  if (!quotedFound) return null;

  // WhatsApp's quotedMessage can be a reduced copy without url/directPath.
  // Recover the original full message by stanza ID from the incoming-message cache.
  const stanzaId = context?.stanzaId;
  const chatJid = context?.remoteJid || message.key?.remoteJid;

  // Prefer the exact chat + stanza key. WhatsApp can quote using a different
  // JID representation (PN/LID), so fall back to the cached message ID.
  if (stanzaId && cache?.get) {
    const exactKeys = [
      chatJid && chatJid + ":" + stanzaId,
      message.key?.remoteJid && message.key.remoteJid + ":" + stanzaId,
      context?.remoteJid && context.remoteJid + ":" + stanzaId
    ].filter(Boolean);
    for (const key of new Set(exactKeys)) {
      const original = cache.get(key);
      const cachedFound = extractViewOnceMedia(original?.message);
      if (cachedFound && hasDownloadLocation(cachedFound.media)) return cachedFound;
    }

    if (typeof cache.values === "function") {
      for (const original of cache.values()) {
        if (original?.key?.id !== stanzaId) continue;
        if (chatJid && original.key.remoteJid !== chatJid &&
            original.key.remoteJid !== message.key?.remoteJid &&
            original.key.remoteJid !== context?.remoteJid) continue;
        const cachedFound = extractViewOnceMedia(original.message);
        if (cachedFound && hasDownloadLocation(cachedFound.media)) return cachedFound;
      }
    }
  }

  // Never pass a reduced quoted payload to Baileys: it throws
  // "No valid media URL or directPath present in message".
  return hasDownloadLocation(quotedFound.media) ? quotedFound : null;
}

function findMedia(message) {
  const current = message.message || {};
  const quoted = current.extendedTextMessage?.contextInfo?.quotedMessage || {};
  const candidates = [
    ["imageMessage", current.imageMessage || quoted.imageMessage, "image"],
    ["videoMessage", current.videoMessage || quoted.videoMessage, "video"]
  ];
  return candidates.find(([, value]) => value) || null;
}

async function download(media, kind, destination) {
  const stream = await downloadContentFromMessage(media, kind);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_INPUT) throw new Error("64 MB සීමාව ඉක්මවා ඇත.");
    chunks.push(chunk);
  }
  if (!size) throw new Error("Media data ලබාගත නොහැක.");
  fs.writeFileSync(destination, Buffer.concat(chunks));
}

export function commandOf(body, prefix) {
  if (!body.startsWith(prefix)) return "";
  return body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase();
}

export async function handleViewOnceCommand({ sock, message, jid, found, downloadMedia = download }) {
  if (!found) {
    return sock.sendMessage(jid, {
      text: "📎 View Once Photo/Video එකකට Reply කර .vv හෝ .Vv යවන්න."
    }, { quoted: message });
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-view-once-"));
  const input = path.join(work, found.kind === "image" ? "view-once.jpg" : "view-once.mp4");
  try {
    await sock.sendMessage(jid, { text: "♻️ View Once media එක සාමාන්‍ය " + (found.kind === "image" ? "Photo" : "Video") + " එකක් ලෙස සකස් කරමින්..." }, { quoted: message });
    await downloadMedia(found.media, found.kind, input);
    const data = fs.readFileSync(input);
    if (found.kind === "image") {
      return await sock.sendMessage(jid, {
        image: data,
        mimetype: found.media.mimetype || "image/jpeg",
        caption: "✅ *VIEW ONCE PHOTO SAVED • HASA 2 BOT*"
      }, { quoted: message });
    }
    return await sock.sendMessage(jid, {
      video: data,
      mimetype: found.media.mimetype || "video/mp4",
      caption: "✅ *VIEW ONCE VIDEO SAVED • HASA 2 BOT*"
    }, { quoted: message });
  } catch (error) {
    console.error("View Once save failed:", error?.message || error);
    const reason = /ENOENT/.test(String(error?.code))
      ? "Media download එකට අවශ්‍ය file එක සොයාගත නොහැක."
      : error.message || "නැවත උත්සාහ කරන්න.";
    return sock.sendMessage(jid, { text: "❌ View Once Save Error: " + reason }, { quoted: message });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export default async function mediaTools({ sock, message, config, cache }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const prefix = config.prefix || ".";
  const body = (message.message?.conversation || message.message?.extendedTextMessage?.text || "").trim();
  const command = commandOf(body, prefix);

  if (command === "vv") {
    return handleViewOnceCommand({ sock, message, jid, found: findQuotedViewOnceMedia(message, cache) });
  }

  if (!["sticker", "s", "toaudio", "compress"].includes(command)) return;

  const found = findMedia(message);
  if (!found) {
    return sock.sendMessage(jid, {
      text: "📎 Photo/Video එකකට Reply කර " + prefix + command + " යවන්න."
    }, { quoted: message });
  }
  const [, media, kind] = found;
  if ((command === "toaudio" || command === "compress") && kind !== "video") {
    return sock.sendMessage(jid, { text: command === "toaudio" ? "🎵 Audio කරන්න Video එකකට Reply කරන්න." : "📦 Compress කරන්න Video එකකට Reply කරන්න." }, { quoted: message });
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "hasa-media-"));
  const input = path.join(work, kind === "image" ? "input.jpg" : "input.mp4");
  try {
    await sock.sendMessage(jid, {
      text: command === "toaudio" ? "🎵 Audio එක සකස් කරමින්..." :
        command === "compress" ? "📦 Video එක Compress කරමින්..." : "✨ Sticker එක සකස් කරමින්..."
    }, { quoted: message });
    await download(media, kind, input);

    if (command === "sticker" || command === "s") {
      const output = path.join(work, "sticker.webp");
      const args = kind === "image"
        ? ["-y", "-i", input, "-vf", "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000", "-frames:v", "1", "-vcodec", "libwebp", "-lossless", "0", "-q:v", "75", output]
        : ["-y", "-i", input, "-t", "8", "-an", "-vf", "fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000", "-vcodec", "libwebp", "-loop", "0", "-q:v", "70", output];
      await exec("ffmpeg", args, { timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
      const data = fs.readFileSync(output);
      if (data.length > 1024 * 1024) throw new Error("Sticker එක 1 MB ඉක්මවා ඇත. කුඩා Photo/Video එකක් උත්සාහ කරන්න.");
      return await sock.sendMessage(jid, { sticker: data }, { quoted: message });
    }

    if (command === "toaudio") {
      const output = path.join(work, "audio.mp3");
      await exec("ffmpeg", ["-y", "-i", input, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", "-t", "600", output], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
      const data = fs.readFileSync(output);
      if (data.length > 16 * 1024 * 1024) throw new Error("Audio එක 16 MB ඉක්මවා ඇත.");
      return await sock.sendMessage(jid, { audio: data, mimetype: "audio/mpeg", fileName: "hasa-audio.mp3" }, { quoted: message });
    }

    const output = path.join(work, "compressed.mp4");
    await exec("ffmpeg", ["-y", "-i", input, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-t", "600", output], { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
    const data = fs.readFileSync(output);
    if (data.length > 64 * 1024 * 1024) throw new Error("Compressed Video එකත් 64 MB ඉක්මවා ඇත.");
    return await sock.sendMessage(jid, { video: data, caption: "✅ *VIDEO COMPRESSED • HASA 2 BOT*" }, { quoted: message });
  } catch (error) {
    console.error("Media tool failed:", error?.message || error);
    const reason = /ENOENT/.test(String(error?.code)) ? "Server එකේ FFmpeg ස්ථාපනය කර නැහැ." : error.message || "නැවත උත්සාහ කරන්න.";
    return sock.sendMessage(jid, { text: "❌ Media Tool Error: " + reason }, { quoted: message });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
