function jidNumber(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function normalizedJid(value) {
  return String(value || "").replace(/:\d+(?=@)/, "").trim().toLowerCase();
}

/** Public mode accepts every chat; private mode accepts only the account's own direct self-chat. */
export function isMessageAllowedByMode(message, sock, config) {
  if (config?.publicMode !== false) return true;
  const jid = message?.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us")) return false;
  if (message?.key?.fromMe !== true) return false;

  const ownJids = [sock?.user?.id, sock?.user?.lid].filter(Boolean);
  const allowedNumbers = (ownJids.length ? ownJids : (Array.isArray(config?.owner) ? config.owner : []))
    .map(jidNumber).filter(Boolean);
  const targetNumber = jidNumber(jid);
  return ownJids.some(own => normalizedJid(own) === normalizedJid(jid)) ||
    Boolean(targetNumber && allowedNumbers.includes(targetNumber));
}
