const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function ownerOnly(sender, message, config) {
  if (message.key.fromMe) return true;
  const number = String(sender || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(item => String(item).replace(/\D/g, "") === number);
}
export default async function prank({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  const body = (message.message?.conversation || message.message?.extendedTextMessage?.text || "").trim();
  const prefix = config.prefix || ".";
  if (!jid || body.toLowerCase() !== prefix + "hack") return;
  const sender = message.key.participant || jid;
  if (!ownerOnly(sender, message, config)) {
    return sock.sendMessage(jid, { text: "⛔ Owner only." }, { quoted: message });
  }
  const steps = [
    "🖥️ *HACKER PRANK SIMULATION STARTED*",
    "🔐 Simulating a security scan...",
    "📡 Simulating network diagnostics...",
    "🛡️ Security check complete."
  ];
  for (const line of steps) {
    await sock.sendMessage(jid, { text: line });
    await wait(650);
  }
  return sock.sendMessage(jid, {
    text: "✅ *PRANK COMPLETE*\n\nThis was only an animation. No account, device, messages, photos, or data were accessed."
  }, { quoted: message });
}
