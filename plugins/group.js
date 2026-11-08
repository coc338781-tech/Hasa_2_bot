export default async function group({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!config.groupCommands || !jid?.endsWith("@g.us")) return;
  const text = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  if (!text.startsWith(prefix)) return;
  const [rawCommand] = text.slice(prefix.length).trim().split(/\s+/);
  const cmd = (rawCommand || "").toLowerCase();
  if (!["tagall", "hidetag", "promote", "demote", "kick", "groupinfo"].includes(cmd)) return;
  const meta = await sock.groupMetadata(jid).catch(() => null);
  if (!meta) return sock.sendMessage(jid, { text: "Could not read group information." }, { quoted: message });
  const clean = value => String(value || "").split("@")[0].split(":")[0];
  const sender = message.key.participant;
  const botJid = sock.user?.id;
  const admins = meta.participants.filter(p => p.admin).map(p => clean(p.id));
  const senderIsAdmin = message.key.fromMe || admins.includes(clean(sender));
  const botIsAdmin = admins.includes(clean(botJid));
  if (cmd === "groupinfo") {
    return sock.sendMessage(jid, { text: "Group: " + meta.subject + "\nMembers: " + meta.participants.length }, { quoted: message });
  }
  if (!senderIsAdmin) return sock.sendMessage(jid, { text: "Only group admins can use this command." }, { quoted: message });
  if (cmd === "tagall" || cmd === "hidetag") {
    const mentions = meta.participants.map(p => p.id);
    const body = text.slice(prefix.length + cmd.length).trim() || "Attention everyone";
    return sock.sendMessage(jid, {
      text: body + (cmd === "tagall" ? "\n" + mentions.map(x => "@" + x.split("@")[0]).join(" ") : ""),
      mentions
    }, { quoted: message });
  }
  if (!botIsAdmin) return sock.sendMessage(jid, { text: "Bot must be a group admin for this action." }, { quoted: message });
  const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return sock.sendMessage(jid, { text: "Mention a member first." }, { quoted: message });
  const action = cmd === "kick" ? "remove" : cmd;
  await sock.groupParticipantsUpdate(jid, [target], action);
  await sock.sendMessage(jid, { text: "Done: " + cmd + " @" + target.split("@")[0], mentions: [target] }, { quoted: message });
}
