import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import {
  findStatusForCommand,
  findStatusMedia,
  getStatusSaveAliases,
  normalizeStatusAlias
} from "../lib/status-saver.js";

const MAX_STATUS_BYTES = 64 * 1024 * 1024;

function getBody(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}

function isOwner(message, config) {
  if (message.key?.fromMe) return true;
  const sender = String(message.key?.participant || message.key?.remoteJid || "")
    .split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(item => String(item).replace(/\D/g, "") === sender);
}

async function downloadStatus(media, kind) {
  const stream = await downloadContentFromMessage(media, kind);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_STATUS_BYTES) throw new Error("Status Media එක 64 MB ඉක්මවා ඇත.");
    chunks.push(chunk);
  }
  if (!size) throw new Error("Status Media එකෙන් Data ලබාගත නොහැක.");
  return Buffer.concat(chunks);
}

export default async function statusSave({ sock, message, config, cache }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const prefix = config.prefix || ".";
  const body = getBody(message).trim();
  if (!body.startsWith(prefix)) return;

  const [rawCommand, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const command = normalizeStatusAlias(rawCommand);
  const aliases = getStatusSaveAliases(config);

  if (command === "statusalias") {
    if (!isOwner(message, config)) {
      return sock.sendMessage(jid, { text: "⛔ Status aliases වෙනස් කළ හැක්කේ Ownerට පමණයි." }, { quoted: message });
    }
    const [action, ...rest] = args;
    const alias = normalizeStatusAlias(rest.join(" "));
    if (action === "list") {
      return sock.sendMessage(jid, {
        text: "📌 *STATUS SAVE ALIASES*\n" + aliases.map(item => prefix + item).join("  |  ") +
          "\n\nඅලුත් එකක්: " + prefix + "statusalias add <නම>\nඉවත් කිරීමට: " + prefix + "statusalias remove <නම>"
      }, { quoted: message });
    }
    if (!["add", "remove"].includes(String(action || "").toLowerCase()) || !alias || /\s/.test(alias)) {
      return sock.sendMessage(jid, {
        text: "භාවිතය:\n" + prefix + "statusalias list\n" + prefix + "statusalias add <නම>\n" + prefix + "statusalias remove <නම>"
      }, { quoted: message });
    }
    const next = [...aliases];
    const index = next.indexOf(alias);
    if (String(action).toLowerCase() === "add") {
      if (index !== -1) return sock.sendMessage(jid, { text: "ℹ️ ඒ alias එක දැනටමත් තියෙනවා." }, { quoted: message });
      next.push(alias);
    } else {
      if (index === -1) return sock.sendMessage(jid, { text: "❌ ඒ alias එක ලැයිස්තුවේ නැහැ." }, { quoted: message });
      next.splice(index, 1);
    }
    config.statusSaveAliases = next;
    try {
      const fs = await import("node:fs");
      fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    } catch (error) {
      console.error("Status alias config save failed:", error.message);
      return sock.sendMessage(jid, { text: "❌ Alias එක Save කරන්න බැරි වුණා: " + error.message }, { quoted: message });
    }
    return sock.sendMessage(jid, {
      text: "✅ Alias " + (String(action).toLowerCase() === "add" ? "එකතු කළා" : "ඉවත් කළා") + ": " + prefix + alias
    }, { quoted: message });
  }

  if (!aliases.includes(command)) return;
  const status = findStatusForCommand(message, cache, jid);
  if (!status) {
    return sock.sendMessage(jid, {
      text: "❌ මේ Chat එකට අදාල Status එක හමු වුණේ නැහැ.\n\nමුලින් ඒ Status එකට Reply එකක් යවලා, ඒ Reply ගිය මේ Chat එකේම " +
        prefix + command + " යවන්න. Status එක පැය 24 ඉක්මවා ඇත්නම් නැවත ලබාගත නොහැක."
    }, { quoted: message });
  }

  const [type, media] = findStatusMedia(status) || [];
  if (!media || !["imageMessage", "videoMessage"].includes(type)) {
    return sock.sendMessage(jid, {
      text: "❌ මේ Status එක Photo හෝ Video එකක් නොවේ. Photo/Video Status එකක් උත්සාහ කරන්න."
    }, { quoted: message });
  }

  try {
    await sock.sendMessage(jid, { text: "⏳ *Status එක ලබාගනිමින්...*" }, { quoted: message });
    const kind = type === "imageMessage" ? "image" : "video";
    const data = await downloadStatus(media, kind);
    const caption = media.caption || "✅ *STATUS SAVED • HASA 2 BOT*";
    if (kind === "image") {
      return await sock.sendMessage(jid, { image: data, caption }, { quoted: message });
    }
    return await sock.sendMessage(jid, { video: data, caption }, { quoted: message });
  } catch (error) {
    console.error("Status save failed:", error?.stack || error?.message || error);
    return sock.sendMessage(jid, {
      text: "❌ Status එක ලබාගන්න බැරි වුණා: " + (error.message || "නැවත උත්සාහ කරන්න.")
    }, { quoted: message });
  }
}
