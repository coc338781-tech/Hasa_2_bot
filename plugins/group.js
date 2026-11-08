import fs from "node:fs";
import path from "node:path";

const settingsFile = path.resolve("./group-settings.json");
const warningsFile = path.resolve("./group-warnings.json");

function readJson(file, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function clean(jid) {
  return String(jid || "").split("@")[0].split(":")[0];
}

function hasLink(text) {
  return /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|bit\.ly\/)[^\s]+/i.test(text);
}

export default async function group({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!config.groupCommands || !jid?.endsWith("@g.us")) return;
  const text = message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
  const prefix = config.prefix || ".";
  const [rawCommand, ...args] = text.trim().startsWith(prefix)
    ? text.trim().slice(prefix.length).split(/\s+/)
    : ["", ""];
  const cmd = (rawCommand || "").toLowerCase();
  const valid = ["tagall", "hidetag", "promote", "demote", "kick", "groupinfo", "antilink", "warn", "warnings", "resetwarn"];
  const settings = readJson(settingsFile, {});
  const groupSettings = settings[jid] || {};
  const sender = message.key.participant || jid;
  const senderId = clean(sender);
  const isAdmin = participants => message.key.fromMe || participants.some(p => p.admin && clean(p.id) === senderId);

  // Link moderation runs on ordinary messages as well as commands.
  if (groupSettings.antiLink === true && !valid.includes(cmd) && hasLink(text)) {
    const meta = await sock.groupMetadata(jid).catch(() => null);
    if (!meta) return;
    if (isAdmin(meta.participants)) return;
    const botAdmin = meta.participants.some(p => p.admin && clean(p.id) === clean(sock.user?.id));
    if (!botAdmin) return;
    await sock.sendMessage(jid, { delete: message.key }).catch(() => {});
    const warnings = readJson(warningsFile, {});
    const key = jid + ":" + senderId;
    warnings[key] = (warnings[key] || 0) + 1;
    writeJson(warningsFile, warnings);
    return sock.sendMessage(jid, {
      text: "🚫 @"+senderId+" Links are disabled in this group. Warning "+warnings[key]+"/3.",
      mentions: [sender]
    });
  }

  if (!valid.includes(cmd)) return;
  const meta = await sock.groupMetadata(jid).catch(() => null);
  if (!meta) return sock.sendMessage(jid, { text: "Group information කියවන්න බැරි වුණා." }, { quoted: message });
  const participants = meta.participants;
  const senderIsAdmin = isAdmin(participants);
  const botIsAdmin = participants.some(p => p.admin && clean(p.id) === clean(sock.user?.id));

  if (cmd === "groupinfo") {
    return sock.sendMessage(jid, {
      text: "╭━━〔 👥 GROUP INFO 〕━━╮\n┃ Name: "+meta.subject+
        "\n┃ Members: "+participants.length+
        "\n┃ Anti-link: "+(groupSettings.antiLink ? "ON 🟢" : "OFF 🔴")+
        "\n╰━━━━━━━━━━━━━━━━━━"
    }, { quoted: message });
  }

  if (!senderIsAdmin) {
    return sock.sendMessage(jid, { text: "⛔ මේ Group Command එක භාවිතා කළ හැක්කේ Group Admin කෙනෙකුට පමණයි." }, { quoted: message });
  }

  if (cmd === "antilink") {
    const mode = (args[0] || "").toLowerCase();
    if (!["on", "off"].includes(mode)) {
      return sock.sendMessage(jid, { text: "භාවිතය: "+prefix+"antilink on/off" }, { quoted: message });
    }
    if (mode === "on" && !botIsAdmin) {
      return sock.sendMessage(jid, { text: "⛔ Anti-link ක්‍රියාත්මක කිරීමට Bot එක Group Admin විය යුතුයි." }, { quoted: message });
    }
    settings[jid] = { ...groupSettings, antiLink: mode === "on" };
    writeJson(settingsFile, settings);
    return sock.sendMessage(jid, { text: "✅ *ANTI-LINK:* "+mode.toUpperCase()+(mode === "on" ? " 🟢" : " 🔴") }, { quoted: message });
  }

  const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  const target = mentioned[0];
  if (cmd === "warn" || cmd === "warnings" || cmd === "resetwarn") {
    if (!target) return sock.sendMessage(jid, { text: "Member කෙනෙක් Mention කරන්න." }, { quoted: message });
    const warnings = readJson(warningsFile, {});
    const key = jid + ":" + clean(target);
    if (cmd === "warnings") {
      return sock.sendMessage(jid, { text: "⚠️ @"+clean(target)+" Warnings: "+(warnings[key] || 0), mentions: [target] }, { quoted: message });
    }
    if (cmd === "resetwarn") {
      delete warnings[key];
      writeJson(warningsFile, warnings);
      return sock.sendMessage(jid, { text: "✅ @"+clean(target)+" ගේ Warnings Reset කළා.", mentions: [target] }, { quoted: message });
    }
    const reason = args.slice(1).join(" ").trim() || "No reason provided";
    warnings[key] = (warnings[key] || 0) + 1;
    writeJson(warningsFile, warnings);
    return sock.sendMessage(jid, {
      text: "⚠️ *WARNING "+warnings[key]+"/3*\nMember: @"+clean(target)+"\nReason: "+reason,
      mentions: [target]
    }, { quoted: message });
  }

  if (cmd === "tagall" || cmd === "hidetag") {
    const mentions = participants.map(p => p.id);
    const body = text.slice(prefix.length + cmd.length).trim() || "Attention everyone";
    return sock.sendMessage(jid, {
      text: body + (cmd === "tagall" ? "\n" + mentions.map(x => "@"+clean(x)).join(" ") : ""),
      mentions
    }, { quoted: message });
  }

  if (!botIsAdmin) return sock.sendMessage(jid, { text: "Bot එකට මේ ක්‍රියාව සඳහා Group Admin අවසරය අවශ්‍යයි." }, { quoted: message });
  if (!target) return sock.sendMessage(jid, { text: "Member කෙනෙක් Mention කරන්න." }, { quoted: message });
  const action = cmd === "kick" ? "remove" : cmd;
  await sock.groupParticipantsUpdate(jid, [target], action);
  return sock.sendMessage(jid, { text: "✅ Done: "+cmd+" @"+clean(target), mentions: [target] }, { quoted: message });
}
