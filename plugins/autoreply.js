import fs from "node:fs";
import path from "node:path";

const file = path.resolve("./replies.json");
function readReplies() {
  try {
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (error) {
    console.error("replies.json read error:", error.message);
    return {};
  }
}
function writeReplies(data) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, file);
}
function isOwner(sender, message, config) {
  if (message.key.fromMe) return true;
  const number = (sender || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(item => String(item).replace(/\D/g, "") === number);
}
export default async function autoReply({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const body = (message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "").trim();
  if (!body) return;
  const prefix = config.prefix || ".";
  const sender = message.key.participant || jid;
  const owner = isOwner(sender, message, config);
  const lower = body.toLowerCase();
  const command = lower.split(/\s+/)[0];
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });

  if ([prefix+"addreply", prefix+"replaceeply", prefix+"replacereply", prefix+"removereply", prefix+"getreply", prefix+"resetreply"].includes(command)) {
    if (!owner) return send("⛔ මේ command එක owner ට විතරයි.");
    const args = body.slice(command.length).trim();
    const replies = readReplies();
    if (command === prefix+"addreply" || command === prefix+"replaceeply" || command === prefix+"replacereply") {
      const splitAt = args.indexOf("-");
      if (splitAt < 1 || !args.slice(splitAt + 1).trim()) {
        return send("භාවිතය: " + command + " වචනය-උත්තරය");
      }
      const trigger = args.slice(0, splitAt).trim().toLowerCase();
      if (command === prefix+"addreply" && replies[trigger]) return send("මේ වචනයට reply එකක් දැනටමත් තියෙනවා. replaceeply භාවිතා කරන්න.");
      replies[trigger] = args.slice(splitAt + 1).trim();
      writeReplies(replies);
      return send("✅ Auto reply save කළා: " + trigger);
    }
    if (command === prefix+"removereply") {
      const trigger = args.toLowerCase();
      if (!trigger || !replies[trigger]) return send("ඒ වචනයට reply එකක් හමු වුණේ නෑ.");
      delete replies[trigger];
      writeReplies(replies);
      return send("🗑️ Reply එක ඉවත් කළා: " + trigger);
    }
    if (command === prefix+"getreply") {
      const entries = Object.entries(replies);
      return send(entries.length ? entries.map(([key, value]) => "• " + key + " → " + value).join("\n") : "Auto reply කිසිවක් නැහැ.");
    }
    writeReplies({});
    return send("🗑️ සියලුම auto replies ඉවත් කළා.");
  }

  if (body.startsWith(prefix) || message.key.fromMe || jid.endsWith("@g.us")) return;
  if (config.autoReply !== true) return;
  const reply = readReplies()[lower];
  if (reply) await sock.sendMessage(jid, { text: reply }, { quoted: message });
}
