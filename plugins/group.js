export default async function group({ sock, message, config }) {
  const jid = message.key.remoteJid;
  if (!config.groupCommands || !jid.endsWith("@g.us")) return;
  const text = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  if (!text.startsWith(prefix)) return;
  const [cmd] = text.slice(prefix.length).trim().split(/\\s+/);
  if (!["tagall","hidetag","promote","demote","kick","groupinfo"].includes(cmd)) return;
  const meta = await sock.groupMetadata(jid).catch(() => null);
  if (!meta) return;
  const sender = message.key.participant;
  const admins = meta.participants.filter(p => p.admin).map(p => p.id);
  const bot = sock.user.id.split(":")[0] + "@s.whatsapp.net";
  if (!admins.includes(sender) && !message.key.fromMe) return sock.sendMessage(jid,{text:"Only group admins can use this command."},{quoted:message});
  if (cmd === "groupinfo") return sock.sendMessage(jid,{text:"Group: "+meta.subject+"\\nMembers: "+meta.participants.length});
  if (cmd === "tagall" || cmd === "hidetag") {
    const mentions = meta.participants.map(p=>p.id);
    const body = text.slice(prefix.length + cmd.length).trim() || "Attention everyone";
    return sock.sendMessage(jid,{text:body+"\\n"+(cmd==="tagall"?mentions.map(x=>"@"+x.split("@")[0]).join(" "):""),mentions});
  }
  const target = message.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
  if (!target) return sock.sendMessage(jid,{text:"Mention a member first."},{quoted:message});
  const action = cmd === "kick" ? "remove" : cmd;
  await sock.groupParticipantsUpdate(jid,[target],action);
  await sock.sendMessage(jid,{text:"Done: "+cmd+" @"+target.split("@")[0],mentions:[target]});
}
