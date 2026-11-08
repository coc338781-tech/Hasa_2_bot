import { GoogleGenerativeAI } from "@google/generative-ai";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const MAX_AI_MEDIA = 15 * 1024 * 1024;

function getText(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}

function findMedia(message) {
  const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || {};
  const own = message.message || {};
  const candidates = [
    ["imageMessage", quoted.imageMessage],
    ["audioMessage", quoted.audioMessage],
    ["imageMessage", own.imageMessage],
    ["audioMessage", own.audioMessage]
  ];
  return candidates.find(([, value]) => value) || [null, null];
}

async function mediaToInlineData(media, type) {
  const downloadType = type === "imageMessage" ? "image" : "audio";
  const stream = await downloadContentFromMessage(media, downloadType);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_AI_MEDIA) throw new Error("AI සඳහා Media එක 15 MB ට අඩු විය යුතුයි.");
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error("Media data ලබාගත නොහැක.");
  const fallback = type === "imageMessage" ? "image/jpeg" : "audio/ogg";
  return {
    inlineData: {
      mimeType: String(media.mimetype || fallback).split(";")[0].trim(),
      data: buffer.toString("base64")
    }
  };
}

export default async function ai({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const text = getText(message).trim();
  const prefix = config.prefix || ".";
  const commandPrefix = prefix + "ai";
  if (!text.toLowerCase().startsWith(commandPrefix.toLowerCase())) return;
  const boundary = text.slice(commandPrefix.length, commandPrefix.length + 1);
  if (boundary && !/\s/.test(boundary)) return;

  const prompt = text.slice(commandPrefix.length).trim();
  const [mediaType, media] = findMedia(message);
  if (!prompt && !media) {
    return sock.sendMessage(jid, {
      text: "🤖 *HASA AI ASSISTANT*\n\nභාවිතය: .ai ඔබේ ප්‍රශ්නය\nImage/Voice එකකට Reply කර .ai යවන්න."
    }, { quoted: message });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key || !config.aiChat) {
    return sock.sendMessage(jid, {
      text: !key
        ? "⚠️ AI සේවාව සකස් කර නැහැ. Owner විසින් GEMINI_API_KEY එක සකස් කළ යුතුයි."
        : "⚠️ AI Chat දැනට OFF. Ownerට .aichat on භාවිතා කරන්න පුළුවන්."
    }, { quoted: message });
  }

  try {
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({ model: config.aiModel || "gemini-2.0-flash" });
    const parts = [];
    if (prompt) parts.push({ text: prompt });
    else if (mediaType === "audioMessage") parts.push({ text: "Please transcribe this voice message and briefly explain its meaning. Reply in the language spoken." });
    else parts.push({ text: "Please describe this image and answer helpfully in the user's language." });
    if (media) parts.push(await mediaToInlineData(media, mediaType));

    const result = await model.generateContent(parts);
    const answer = result.response.text()?.trim();
    if (!answer) throw new Error("AI වෙතින් පිළිතුරක් ලැබුණේ නැහැ.");
    await sock.sendMessage(jid, {
      text: "🤖 *HASA AI*\n\n" + answer + "\n\n_❤️ POWERED BY HASA_"
    }, { quoted: message });
  } catch (error) {
    console.error("AI request failed:", error.stack || error.message);
    const reason = String(error.message || error).slice(0, 180);
    await sock.sendMessage(jid, {
      text: "⚠️ *AI පිළිතුර ලබාගන්න බැරි වුණා.*\n\n" +
        (reason.includes("15 MB") ? reason : "සේවාව තාවකාලිකව අසාර්ථකයි. ටික වේලාවකින් නැවත උත්සාහ කරන්න.")
    }, { quoted: message });
  } finally {
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
  }
}
