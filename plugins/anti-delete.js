export default async function antiDelete({ sock, message, config, cache }) {
  if (!config.antiDelete) return;
  const jid = message.key?.remoteJid;
  const protocol = message.message?.protocolMessage;
  if (!jid || jid === "status@broadcast" || !protocol || protocol.type !== 0) return;

  const deletedKey = protocol.key;
  if (!deletedKey?.id) return;
  const cacheKey = (deletedKey.remoteJid || jid) + ":" + deletedKey.id;
  const original = cache?.get(cacheKey);
  if (!original?.message) return;

  const sender = deletedKey.participant || deletedKey.remoteJid || jid;
  const body = original.message.conversation ||
    original.message.extendedTextMessage?.text ||
    original.message.imageMessage?.caption ||
    original.message.videoMessage?.caption ||
    original.message.documentMessage?.caption ||
    original.message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    "[media message]";

  const isGroup = jid.endsWith("@g.us");
  const mode = typeof config.antiDelete === "string" ? config.antiDelete.toLowerCase() : "all";
  if (mode === "off" || mode === "false") return;
  if (mode === "inbox" && isGroup) return;
  if (mode === "groups" && !isGroup) return;

  const ownerNumber = sock.user?.id?.split(":")[0];
  const target = config.antiDeleteToInbox && ownerNumber
    ? ownerNumber + "@s.whatsapp.net"
    : jid;

  await sock.sendMessage(target, {
    text: "🗑️ *ANTI-DELETE*\nFrom: @" + sender.split("@")[0] + "\n\n" + body,
    mentions: [sender]
  });

  const content = original.message;
  const hasMedia = [
    "imageMessage", "videoMessage", "audioMessage", "documentMessage",
    "documentWithCaptionMessage", "stickerMessage"
  ].some(type => content[type]);
  if (hasMedia) {
    await sock.sendMessage(target, { forward: original, force: true }).catch(error =>
      console.error("Anti-delete media forward failed:", error.message));
  }

  cache.delete(cacheKey);
}
