function getContent(message) {
  let content = message?.message || {};
  for (let depth = 0; depth < 3; depth++) {
    const wrapped = content.documentWithCaptionMessage?.message ||
      content.ephemeralMessage?.message ||
      content.viewOnceMessageV2?.message ||
      content.viewOnceMessage?.message;
    if (!wrapped) break;
    content = wrapped;
  }
  return content;
}

function getText(content) {
  return content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    content.audioMessage?.caption ||
    "[media message]";
}

const MEDIA_TYPES = [
  "imageMessage", "videoMessage", "audioMessage",
  "documentMessage", "stickerMessage"
];

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
  const isGroup = jid.endsWith("@g.us");
  const mode = typeof config.antiDelete === "string"
    ? config.antiDelete.toLowerCase()
    : "all";
  if (["off", "false"].includes(mode)) return;
  if (mode === "inbox" && isGroup) return;
  if (mode === "groups" && !isGroup) return;

  const ownerNumber = sock.user?.id?.split(":")[0];
  const target = config.antiDeleteToInbox && ownerNumber
    ? ownerNumber + "@s.whatsapp.net"
    : jid;
  const content = getContent(original);
  let delivered = false;

  try {
    await sock.sendMessage(target, {
      text: "🗑️ *ANTI-DELETE*\nFrom: @" + sender.split("@")[0] + "\n\n" + getText(content),
      mentions: [sender]
    });
    delivered = true;
  } catch (error) {
    console.error("Anti-delete notice failed:", error.message);
  }

  if (MEDIA_TYPES.some(type => content[type])) {
    try {
      await sock.sendMessage(target, { forward: original, force: true });
      delivered = true;
    } catch (error) {
      console.error("Anti-delete media resend failed:", error.message);
    }
  }

  // Keep the cached original if delivery failed, allowing a later retry.
  if (delivered) cache.delete(cacheKey);
}
