export const DEFAULT_STATUS_SAVE_ALIASES = [
  "save", "dpn", "dapan", "one", "evapan",
  "දාපන්", "ඔනේ", "ඕනේ", "සේව්", "එවපන්"
];

export function normalizeStatusAlias(value) {
  return String(value || "").trim().replace(/^\\.+/, "").toLocaleLowerCase();
}

export function getStatusSaveAliases(config = {}) {
  const configured = Array.isArray(config.statusSaveAliases) ? config.statusSaveAliases : [];
  const values = configured.length ? configured : DEFAULT_STATUS_SAVE_ALIASES;
  return [...new Set(values.map(normalizeStatusAlias).filter(value => value && !/\\s/.test(value)))];
}

function collectContextInfo(message, depth = 0) {
  if (!message?.message || depth > 3) return [];
  const contexts = [];
  for (const value of Object.values(message.message)) {
    if (!value || typeof value !== "object") continue;
    if (value.contextInfo && typeof value.contextInfo === "object") {
      contexts.push(value.contextInfo);
      if (value.contextInfo.quotedMessage) {
        contexts.push(...collectContextInfo({ message: value.contextInfo.quotedMessage }, depth + 1));
      }
    }
    if (value.message && typeof value.message === "object") {
      contexts.push(...collectContextInfo({ message: value.message }, depth + 1));
    }
  }
  return contexts;
}

function lookupStatus(cache, contextInfo) {
  const id = contextInfo?.stanzaId;
  if (!id || !cache?.get) return null;
  const status = cache.get("status@broadcast:" + id);
  if (!status?.message) return null;
  const expectedParticipant = String(contextInfo.participant || "").split(":")[0];
  const actualParticipant = String(status.key?.participant || "").split(":")[0];
  if (expectedParticipant && actualParticipant && expectedParticipant !== actualParticipant) return null;
  return status;
}

export function findStatusForCommand(message, cache, jid) {
  const directContexts = collectContextInfo(message);
  for (const context of directContexts) {
    const found = lookupStatus(cache, context);
    if (found) return found;
  }

  // A normal Status reply is synced as an outgoing message in the Status owner's chat.
  // Find the newest such reply when the user sends the save command in that same chat.
  if (cache?.entries) {
    const entries = [...cache.entries()].reverse();
    for (const [key, candidate] of entries) {
      if (candidate?.key?.remoteJid !== jid || !candidate.key?.fromMe) continue;
      for (const context of collectContextInfo(candidate)) {
        const found = lookupStatus(cache, context);
        if (found) return found;
      }
    }
  }
  return null;
}

export function findStatusMedia(status) {
  const content = status?.message || {};
  const candidates = [
    ["imageMessage", content.imageMessage],
    ["videoMessage", content.videoMessage],
    ["imageMessage", content.ephemeralMessage?.message?.imageMessage],
    ["videoMessage", content.ephemeralMessage?.message?.videoMessage],
    ["imageMessage", content.viewOnceMessageV2?.message?.imageMessage],
    ["videoMessage", content.viewOnceMessageV2?.message?.videoMessage]
  ];
  return candidates.find(([, media]) => media) || null;
}
