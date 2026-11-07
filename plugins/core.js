export default async function core({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid) return;
  const sender = message.key.participant || jid;
  const text = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  if (!text) return;
  const prefix = config.prefix || ".";
  if (!text.startsWith(prefix)) return;
  const [command, ...args] = text.slice(prefix.length).trim().split(/\s+/);
  const arg = args.join(" ");
  const number = sender.split("@")[0].split(":")[0].replace(/\D/g, "");
  const owner = message.key.fromMe || (config.owner || []).some(value => String(value).replace(/\D/g, "") === number);
  if (command === "menu" || command === "help") {
    return sock.sendMessage(jid, { text: [
      "*HASA 2 BOT COMMANDS*",
      ".ping - Check bot",
      ".alive - Bot status",
      ".uptime - Running time",
      ".tagall / .hidetag - Group mentions (admin)",
      ".promote / .demote / .kick @user - Group admin commands",
      ".groupinfo - Group information",
      ".ai <question> - AI response (Gemini key required)",
      ".hack - Owner-only prank simulation",
      ".dl <url> / .fb <url> - Download video (yt-dlp required)",
      ".addreply word-reply / .replaceeply word-reply",
      ".getreply / .removereply word / .resetreply",
      ".autoreply on|off - Owner setting",
      ".statusseen on|off - Owner setting",
      ".helpsubbot - Subbot help (when enabled)"
    ].join("\n") }, { quoted: message });
  }
  if (command === "ping") return sock.sendMessage(jid, { text: "Pong! 🏓" }, { quoted: message });
  if (command === "alive") return sock.sendMessage(jid, { text: "Hasa_2_bot is running ✅" }, { quoted: message });
  if (["autoreply", "statusseen"].includes(command)) {
    if (!owner) return sock.sendMessage(jid, { text: "⛔ Owner only." }, { quoted: message });
    if (!["on", "off"].includes(arg.toLowerCase())) {
      return sock.sendMessage(jid, { text: "Use: " + prefix + command + " on|off" }, { quoted: message });
    }
    config[command === "autoreply" ? "autoReply" : "autoStatusSeen"] = arg.toLowerCase() === "on";
    try {
      const fs = await import("node:fs");
      fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
    } catch (error) {
      console.error("Config save failed:", error.message);
    }
    return sock.sendMessage(jid, { text: command + " set to " + arg.toLowerCase() }, { quoted: message });
  }
}
