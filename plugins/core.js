import fs from "node:fs";

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

export default async function core({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid) return;
  const sender = message.key.participant || jid;
  const body = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  if (!body) return;
  const prefix = config.prefix || ".";
  if (!body.startsWith(prefix)) return;

  const [rawCommand, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const command = (rawCommand || "").toLowerCase();
  const arg = args.join(" ").trim().toLowerCase();
  const number = sender.split("@")[0].split(":")[0].replace(/\D/g, "");
  const owner = message.key.fromMe || (config.owner || []).some(value =>
    String(value).replace(/\D/g, "") === number
  );
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });

  if (command === "menu" || command === "help") {
    return send([
      "╭━━〔 🤖 *HASA 2 BOT* 〕━━╮",
      "┃",
      "┃ 🟢 *BASIC COMMANDS*",
      "┃ " + prefix + "ping  - Bot response check",
      "┃ " + prefix + "alive - Bot status",
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
  if (command === "alive") return send("✅ *HASA 2 BOT IS ALIVE*");
  if (command === "settings" || command === "setting") {
    if (!owner) return send("⛔ Owner only.");
    return send(settingsText(config, prefix));
  }

  if (Object.hasOwn(SETTINGS, command)) {
    if (!owner) return send("⛔ මේ setting එක වෙනස් කළ හැක්කේ Ownerට පමණයි.");
    if (!["on", "off"].includes(arg)) {
      return send("භාවිතය: " + prefix + command + " on/off\n\n" + settingsText(config, prefix));
    }
    const [key] = SETTINGS[command];
    config[key] = key === "antiDelete" && arg === "on" ? true : arg === "on";
    try {
      fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    } catch (error) {
      console.error("Config save failed:", error.message);
      return send("❌ Setting save කරන්න බැරි වුණා: " + error.message);
    }
    return send("✅ *" + SETTINGS[command][1] + "* " + (arg === "on" ? "ON 🟢" : "OFF 🔴") + "\n\n" + settingsText(config, prefix));
  }
}
