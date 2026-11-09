import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function bodyOf(message) {
  return message.message?.conversation || message.message?.extendedTextMessage?.text || "";
}
function ownerOnly(message, jid, config) {
  if (message.key?.fromMe) return true;
  const sender = String(message.key?.participant || jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(n => String(n).replace(/\D/g, "") === sender);
}
function safeLine(line) {
  return String(line).replace(/[0-9]{8,}/g, "[NUMBER]").replace(/https?:\/\/\S+/g, "[URL]")
    .replace(/[\w.+-]+@[\w.-]+/g, "[ADDRESS]").slice(0, 240);
}
export default async function ownerTools({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const body = bodyOf(message).trim();
  const prefix = config.prefix || ".";
  if (!body.startsWith(prefix)) return;
  const [command] = body.slice(prefix.length).trim().split(/\s+/);
  const cmd = (command || "").toLowerCase();
  if (!["status", "logs", "backup", "owner"].includes(cmd)) return;
  if (!ownerOnly(message, jid, config)) return sock.sendMessage(jid, { text: "⛔ මේ command එක භාවිතා කළ හැක්කේ Ownerට පමණයි." }, { quoted: message });
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });
  if (cmd === "status") {
    const plugins = globalThis.__hasaPlugins;
    return send([
      "📡 *HASA BOT STATUS*",
      "",
      "WhatsApp: " + (sock.user?.id ? "Connected 🟢" : "Not connected 🔴"),
      "Bot uptime: " + Math.floor(process.uptime() / 60) + " minutes",
      "Node.js: " + process.version,
      "Plugins: " + (plugins?.count ?? "Unknown"),
      "Mode: " + (config.publicMode === false ? "Private" : "Public")
    ].join("\n"));
  }
  if (cmd === "owner") {
    const owners = (config.owner || []).map(value => {
      const digits = String(value).replace(/\D/g, "");
      return digits.length > 4 ? digits.slice(0, 2) + "******" + digits.slice(-2) : "Configured";
    });
    return send("👑 *HASA BOT OWNER SETTINGS*\nConfigured owner accounts: " + owners.length +
      (owners.length ? "\n" + owners.join("\n") : "\nNo owner number configured."));
  }
  if (cmd === "backup") {
    const configData = await fs.readFile("./config.json");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = "hasa-config-backup-" + stamp + ".json";
    return sock.sendMessage(jid, {
      document: configData, mimetype: "application/json", fileName,
      caption: "Config backup only. WhatsApp auth/session files are intentionally excluded."
    }, { quoted: message });
  }
  if (cmd === "logs") {
    const base = path.join(os.homedir(), ".pm2", "logs");
    const files = ["hasa2-error.log", "hasa2-out.log"];
    const lines = [];
    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(base, file), "utf8");
        const matches = content.split(/\r?\n/).filter(line =>
          /error|warn|exception|failed|timeout|disconnect|reconnect/i.test(line) &&
          !/message|chat|jid|from|to|body|quoted|contact|media|@s\.whatsapp\.net|@g\.us/i.test(line)
        ).slice(-8).map(safeLine);
        if (matches.length) lines.push("[" + file + "]", ...matches);
      } catch {}
    }
    return send(lines.length ? "🧾 *RECENT DIAGNOSTIC LOGS*\n\n" + lines.join("\n").slice(-3000) :
      "✅ Filtered error logs හමු වුණේ නැහැ. (Chat messages සහ personal data පෙන්වන්නේ නැහැ.)");
  }
}
