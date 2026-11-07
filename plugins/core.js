export default async function core({ sock, message, config }) {
  const jid = message.key.remoteJid;
  const sender = message.key.participant || jid;
  const text = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  if (!text) return;
  const prefix = config.prefix || ".";
  const isCommand = text.startsWith(prefix);
  if (config.autoReply && !isCommand && !message.key.fromMe && !jid.endsWith("@g.us")) {
    await sock.sendMessage(jid, { text: "Thanks for your message! I'll get back to you soon." }, { quoted: message });
  }
  if (!isCommand) return;
  const [command, ...args] = text.slice(prefix.length).trim().split(/\\s+/);
  const arg = args.join(" ");
  const owner = (config.owner || []).some(number => sender.startsWith(number.replace(/\\D/g, "")));
  if (command === "menu" || command === "help") {
    return sock.sendMessage(jid, { text: [
      "*HASA 2 BOT COMMANDS*",
      ".ping - Check bot",
      ".alive - Bot status",
      ".tagall - Mention group members (admin)",
      ".hidetag - Hidden tag group (admin)",
      ".promote @user / .demote @user / .kick @user (admin)",
      ".ai <question> - AI response (Gemini key required)",
      ".dl <url> - Download via yt-dlp (if installed)",
      ".autoreply on|off - Owner setting",
      ".statusseen on|off - Owner setting"
    ].join("\\n") }, { quoted: message });
  }
  if (command === "ping") return sock.sendMessage(jid, { text: "Pong! 🏓" }, { quoted: message });
  if (command === "alive") return sock.sendMessage(jid, { text: "Hasa_2_bot is running ✅" }, { quoted: message });
  if (["autoreply","statusseen"].includes(command) && owner) {
    config[command === "autoreply" ? "autoReply" : "autoStatusSeen"] = arg.toLowerCase() === "on";
    return sock.sendMessage(jid, { text: command + " set to " + arg }, { quoted: message });
  }
}
