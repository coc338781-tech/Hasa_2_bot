import { GoogleGenerativeAI } from "@google/generative-ai";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { recordAiUsage } from "../lib/ai-usage.js";

function messageText(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}

function mediaFromMessage(message, kind) {
  const current = message.message || {};
  const quoted = current.extendedTextMessage?.contextInfo?.quotedMessage || {};
  const keys = kind === "image" ? ["imageMessage"] : ["audioMessage"];
  for (const key of keys) {
    if (current[key]) return current[key];
    if (quoted[key]) return quoted[key];
    if (quoted.viewOnceMessageV2?.message?.[key]) return quoted.viewOnceMessageV2.message[key];
  }
  return null;
}

async function mediaPart(media, kind) {
  const stream = await downloadContentFromMessage(media, kind);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 15 * 1024 * 1024) throw new Error("Media file එක 15 MB සීමාව ඉක්මවා ඇත.");
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error("Media data ලබාගත නොහැක.");
  const fallback = kind === "image" ? "image/jpeg" : "audio/ogg";
  return { inlineData: { data: buffer.toString("base64"), mimeType: media.mimetype || fallback } };
}

function friendlyError(error) {
  const message = String(error?.message || error);
  if (/api key|401|403|unauthorized/i.test(message)) return "Gemini API Key එක පරීක්ෂා කරන්න.";
  if (/429|quota|rate.?limit/i.test(message)) return "AI සේවාවේ සීමාව තාවකාලිකව ඉක්මවා ඇත. ටික වේලාවකින් නැවත උත්සාහ කරන්න.";
  if (/15 MB/i.test(message)) return message;
  return "AI සේවාවෙන් පිළිතුරක් ලබාගන්න බැරි වුණා. ටිකකින් නැවත උත්සාහ කරන්න.";
}

export default async function ai({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const body = messageText(message).trim();
  const prefix = config.prefix || ".";
  const command = body.toLowerCase().split(/\s+/)[0];
  const isAi = command === prefix + "ai";
  const isTranscribe = command === prefix + "transcribe";
  if (!isAi && !isTranscribe) return;

  const key = process.env.GEMINI_API_KEY;
  if (!key || !config.aiChat) {
    return sock.sendMessage(jid, {
      text: "⛔ AI පහසුකම දැනට OFF. Ownerට .settings මඟින් AI Chat ON කර GEMINI_API_KEY සකස් කළ යුතුයි."
    }, { quoted: message });
  }

  const prompt = body.slice(command.length).trim();
  const image = isAi ? mediaFromMessage(message, "image") : null;
  const audio = isTranscribe ? mediaFromMessage(message, "audio") : null;
  if (isAi && !prompt && !image) {
    return sock.sendMessage(jid, { text: "භාවිතය: .ai ඔබේ ප්‍රශ්නය\nImage එකකට Reply කර .ai විස්තර කරන්න යවන්න." }, { quoted: message });
  }
  if (isTranscribe && !audio) {
    return sock.sendMessage(jid, { text: "Voice/Audio message එකකට Reply කර .transcribe යවන්න." }, { quoted: message });
  }

  await sock.sendMessage(jid, { text: isTranscribe ? "🎙️ Voice එක හඳුනාගනිමින්..." : "🤖 HASA AI පිළිතුර සකස් කරමින්..." }, { quoted: message });
  try {
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({ model: config.aiModel || "gemini-2.0-flash" });
    const parts = [];
    if (isTranscribe) {
      parts.push({ text: "Transcribe this audio accurately. Return the spoken words in the language they were spoken. Do not add commentary." });
      parts.push(await mediaPart(audio, "audio"));
    } else {
      if (prompt) parts.push({ text: prompt });
      if (image) parts.push(await mediaPart(image, "image"));
    }
    const result = await model.generateContent(parts);
    await recordAiUsage("gemini", true);
    const answer = result.response.text()?.trim();
    return sock.sendMessage(jid, {
      text: answer || "AI පිළිතුරක් ලබාගත නොහැකි වුණා. නැවත උත්සාහ කරන්න."
    }, { quoted: message });
  } catch (error) {
    await recordAiUsage("gemini", false).catch(() => {});
    console.error("AI request failed:", error?.message || error);
    return sock.sendMessage(jid, { text: "❌ " + friendlyError(error) }, { quoted: message });
  }
}
