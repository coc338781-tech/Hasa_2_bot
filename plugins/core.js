import fs from "node:fs";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const SETTINGS = {
  autoreply: ["autoReply", "Auto Reply"],
  statusseen: ["autoStatusSeen", "Auto Status Seen"],
  antidelete: ["antiDelete", "Anti Delete"],
  viewonce: ["viewOnce", "View Once"],
  aichat: ["aiChat", "AI Chat"],
  groupcmd: ["groupCommands", "Group Commands"],
  composing: ["composing", "Typing Presence"],
  autovoice: ["autoVoice", "Auto Voice"]
};

function enabled(value) {
  if (typeof value === "string") return !["off", "false", "0"].includes(value.toLowerCase());
  return Boolean(value);
}

function saveConfig(config) {
  fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
}

function settingsText(config, prefix) {
  const rows = Object.entries(SETTINGS).map(([command, [key, label]]) =>
    (enabled(config[key]) ? "🟢 ON " : "🔴 OFF") + "  " + label + "  (" + prefix + command + " on/off)"
  );
  return [
    "╭━━〔 ⚙️ *HASA 2 SETTINGS* 〕━━╮",
    ...rows,
    "╰━━━━━━━━━━━━━━━━━━━━━━╯",
    "",
    "🛠️ වෙනස් කිරීමට: " + prefix + "antidelete on හෝ " + prefix + "antidelete off",
    "📌 සියලුම Commands: " + prefix + "menu"
  ].join("\n");
}

function getQuotedImage(message) {
  const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (quoted?.imageMessage) return quoted.imageMessage;
  if (message.message?.imageMessage) return message.message.imageMessage;
  return null;
}

async function saveLogo(sock, message, imageMessage) {
  const stream = await downloadContentFromMessage(imageMessage, "image");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error("Photo එකෙන් image data ලැබුණේ නැහැ.");
  fs.writeFileSync("./bot_logo.jpg", buffer);
}

export default async function core({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid) return;
  const sender = message.key.participant || jid;
  const body = message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
  if (!body) return;

  const prefix = config.prefix || ".";
  const trimmed = body.trim();
  const isPlainSet = /^set\s+/i.test(trimmed);
  if (!trimmed.startsWith(prefix) && !isPlainSet) return;

  const commandBody = isPlainSet ? trimmed : trimmed.slice(prefix.length).trim();
  const [rawCommand, ...args] = commandBody.split(/\s+/);
  const command = (rawCommand || "").toLowerCase();
  const arg = args.join(" ").trim();
  const number = sender.split("@")[0].split(":")[0].replace(/\D/g, "");
  const owner = message.key.fromMe || (config.owner || []).some(value =>
    String(value).replace(/\D/g, "") === number
  );
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });

  // .apply / .applyy — show the logo control panel or save a replied photo as the logo.
  if (command === "apply" || command === "applyy") {
    const imageMessage = getQuotedImage(message);
    if (imageMessage) {
      if (!owner) return send("⛔ Bot Logo එක වෙනස් කළ හැක්කේ Ownerට පමණයි.");
      try {
        await send("⏳ *Bot Logo එක Save කරමින් පවතී...*");
        await saveLogo(sock, message, imageMessage);
        config.BOT_LOGO = "./bot_logo.jpg";
        saveConfig(config);
        return send("✅ *Bot Logo එක සාර්ථකව Update වුණා!* දැන් .alive ගහලා බලන්න.");
      } catch (error) {
        console.error("Logo update failed:", error);
        return send("❌ Logo එක Save කරන්න බැරි වුණා: " + error.message);
      }
    }

    const panelText = [
      "╭━━〔 ⚙️ *HASA 2 CONTROL PANEL* 〕━━╮",
      "┃",
      "┃ *BOT IDENTITY & APPEARANCE*",
      "┃ 1.1 | Bot Name වෙනස් කිරීම",
      "┃ 1.2 | Bot Logo වෙනස් කිරීම",
      "┃ 1.3 | Bot Footer වෙනස් කිරීම",
      "┃ 1.4 | Alive Message වෙනස් කිරීම",
      "┃",
      "╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "📌 *භාවිතා කරන ආකාරය*",
      "• Logo: Photo එකකට Reply කර .apply යවන්න.",
      "• Name: set 1.1 Hasa 2 Bot",
      "• Footer: set 1.3 Hasa 2 Bot",
      "• Alive Message: set 1.4 Your message",
      "",
      "🔹 Logo වෙනස් කිරීම Ownerට පමණයි."
    ].join("\n");

    const logoPath = config.BOT_LOGO || "./bot_logo.jpg";
    if (fs.existsSync(logoPath)) {
      try {
        return await sock.sendMessage(jid, {
          image: fs.readFileSync(logoPath),
          caption: panelText
        }, { quoted: message });
      } catch (error) {
        console.error("Control panel logo send failed:", error.message);
      }
    }
    return send(panelText);
  }

  // Supports both the old plain "set 1.x ..." syntax and ".set 1.x ...".
  if (command === "set") {
    if (!owner) return send("⛔ මේ වෙනස්කම් කළ හැක්කේ Ownerට පමණයි.");
    const [setting, ...valueParts] = args;
    const value = valueParts.join(" ").trim();
    if (!setting || !["1.1", "1.3", "1.4"].includes(setting)) {
      return send("භාවිතය:\nset 1.1 Bot Name\nset 1.3 Footer\nset 1.4 Alive Message");
    }
    if (!value) return send("❌ අලුත් අගය ඇතුළත් කරන්න. උදා: set " + setting + " Hasa 2 Bot");
    if (setting === "1.1") {
      config.BOT_NAME = value;
      config.botName = value;
    } else if (setting === "1.3") {
      config.FOOTER = value;
    } else if (setting === "1.4") {
      config.ALIVE_MSG = value;
    }
    try {
      saveConfig(config);
      return send("✅ *Setting [" + setting + "] Update වුණා:* " + value);
    } catch (error) {
      console.error("Appearance setting save failed:", error);
      return send("❌ Setting Save කරන්න බැරි වුණා: " + error.message);
    }
  }

  if (command === "menu" || command === "help") {
    return send([
      "╭━━〔 🤖 *HASA 2 BOT* 〕━━╮",
      "┃",
      "┃ 🟢 *BASIC COMMANDS*",
      "┃ " + prefix + "ping  - Bot response check",
      "┃ " + prefix + "alive - Bot status + Logo",
      "┃ " + prefix + "uptime - Running time",
      "┃ " + prefix + "menu - Full command list",
      "┃",
      "┃ 👥 *GROUP COMMANDS* (Admin)",
      "┃ " + prefix + "tagall [message]",
      "┃ " + prefix + "hidetag [message]",
      "┃ " + prefix + "promote @user",
      "┃ " + prefix + "demote @user",
      "┃ " + prefix + "kick @user",
      "┃ " + prefix + "groupinfo",
      "┃",
      "┃ 🧠 *AI & MEDIA*",
      "┃ " + prefix + "ai <question> (Gemini key)",
      "┃ " + prefix + "dl <url> / " + prefix + "fb <url> (yt-dlp)",
      "┃ " + prefix + "hack (Owner prank simulation)",
      "┃",
      "┃ 💬 *AUTO REPLY* (Owner)",
      "┃ " + prefix + "addreply word-reply",
      "┃ " + prefix + "replaceeply word-reply",
      "┃ " + prefix + "getreply",
      "┃ " + prefix + "removereply word",
      "┃ " + prefix + "resetreply",
      "┃",
      "┃ ⚙️ *BOT SETTINGS* (Owner)",
      "┃ " + prefix + "settings - View all settings",
      "┃ " + prefix + "apply - Logo / Bot appearance",
      "┃ " + prefix + "autoreply on/off",
      "┃ " + prefix + "statusseen on/off",
      "┃ " + prefix + "antidelete on/off",
      "┃ " + prefix + "viewonce on/off",
      "┃ " + prefix + "aichat on/off",
      "┃ " + prefix + "groupcmd on/off",
      "┃ " + prefix + "composing on/off",
      "┃ " + prefix + "autovoice on/off",
      "┃",
      "┃ 🤝 *SUBBOT* (Owner)",
      "┃ " + prefix + "subbot <number>",
      "┃ " + prefix + "subcheck / " + prefix + "getsubbot",
      "┃ " + prefix + "stopsubbot / " + prefix + "restartsubbot",
      "┃ " + prefix + "delsubbot / " + prefix + "helpsubbot",
      "┃",
      "╰━━━━━━━━━━━━━━━━━━━━━━╯",
      "✨ *Hasa_2_bot | Command Center*"
    ].join("\n"));
  }

  if (command === "ping") return send("🏓 *PONG!*\nHasa_2_bot is active.");

  if (command === "alive") {
    const botName = config.BOT_NAME || config.botName || "Hasa_2_bot";
    const aliveText = config.ALIVE_MSG || "System Online. ⚡\n\n" + botName + " is active and ready.";
    const caption = [
      "✅ *" + aliveText + "*",
      "",
      "🤖 *" + botName + "*",
      "⏱️ *Uptime:* " + Math.floor(process.uptime() / 60) + " minutes",
      config.FOOTER ? "\n_" + config.FOOTER + "_" : ""
    ].join("\n");
    const logoPath = config.BOT_LOGO || "./bot_logo.jpg";
    if (fs.existsSync(logoPath)) {
      try {
        return await sock.sendMessage(jid, {
          image: fs.readFileSync(logoPath),
          caption
        }, { quoted: message });
      } catch (error) {
        console.error("Alive logo send failed:", error.message);
      }
    }
    return send(caption);
  }

  if (command === "settings" || command === "setting") {
    if (!owner) return send("⛔ Owner only.");
    return send(settingsText(config, prefix));
  }

  if (Object.hasOwn(SETTINGS, command)) {
    if (!owner) return send("⛔ මේ setting එක වෙනස් කළ හැක්කේ Ownerට පමණයි.");
    if (!["on", "off"].includes(arg.toLowerCase())) {
      return send("භාවිතය: " + prefix + command + " on/off\n\n" + settingsText(config, prefix));
    }
    const [key] = SETTINGS[command];
    config[key] = arg.toLowerCase() === "on";
    try {
      saveConfig(config);
    } catch (error) {
      console.error("Config save failed:", error.message);
      return send("❌ Setting save කරන්න බැරි වුණා: " + error.message);
    }
    return send("✅ *" + SETTINGS[command][1] + "* " + (arg.toLowerCase() === "on" ? "ON 🟢" : "OFF 🔴") + "\n\n" + settingsText(config, prefix));
  }
}
