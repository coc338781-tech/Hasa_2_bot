export default async function antiDelete({ sock, message, config, cache }) {
  if (!config.antiDelete) return;
  const jid = message.key?.remoteJid;
  const protocol = message.message?.protocolMessage;
  if (!jid || jid === "status@broadcast" || !protocol || protocol.type !== 0) return;
  const deletedKey = protocol.key;
  if (!deletedKey?.id) return;
  const original = cache.get((deletedKey.remoteJid || jid) + ":" + deletedKey.id);
  if (!original) return;
  const sender = deletedKey.participant || deletedKey.remoteJid || jid;
  const body = original.message?.conversation ||
    original.message?.extendedTextMessage?.text ||
    original.message?.imageMessage?.caption ||
    original.message?.videoMessage?.caption ||
    original.message?.documentMessage?.caption || "[media message]";
  const isGroup = jid.endsWith("@g.us");
  const mode = typeof config.antiDelete === "string" ? config.antiDelete.toLowerCase() : "all";
  if (mode === "off" || mode === "false") return;
  if (mode === "inbox" && isGroup) return;
  if (mode === "groups" && !isGroup) return;
  const ownerJid = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
  const target = config.antiDeleteToInbox ? ownerJid : jid;
  await sock.sendMessage(target, {
    text: "🗑️ *ANTI-DELETE*\nFrom: @" + sender.split("@")[0] + "\n\n" + body,
    mentions: [sender]
  });
  const originalContent = original.message || {};
  if (originalContent.imageMessage || originalContent.videoMessage ||
      originalContent.audioMessage || originalContent.documentMessage ||
      originalContent.stickerMessage) {
    await sock.sendMessage(target, { forward: original, force: true }).catch(err =>
      console.error("Anti-delete media forward failed:", err.message));
  }
  cache.delete((deletedKey.remoteJid || jid) + ":" + deletedKey.id);
}
