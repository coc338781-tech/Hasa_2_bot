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
  // Only restore messages sent by someone else; ignore the owner's own deletions.
  if (!deletedKey?.id || deletedKey.fromMe === true) return;
  const cacheKey = (deletedKey.remoteJid || jid) + ":" + deletedKey.id;
  let original = cache?.get(cacheKey);

  // Some Baileys revoke events omit or normalize remoteJid differently
  // (PN/LID addressing). Fall back to the unique cached message ID, while
  // preferring a candidate from the same chat to avoid cross-chat matches.
  if (!original?.message && cache && typeof cache.entries === "function") {
    const matches = [...cache.entries()].filter(([key, value]) =>
      String(key).endsWith(":" + deletedKey.id) && value?.message &&
      (!value.key?.id || value.key.id === deletedKey.id)
    );
    const sameChat = matches.find(([, value]) =>
      value.key?.remoteJid === (deletedKey.remoteJid || jid)
    );
    if (sameChat) original = sameChat[1];
    else if (matches.length === 1) original = matches[0][1];
  }
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
