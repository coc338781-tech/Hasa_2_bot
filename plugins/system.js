import os from "node:os";
export default async function system({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  const body = (message.message?.conversation || message.message?.extendedTextMessage?.text || "").trim();
  const prefix = config.prefix || ".";
  const cmd = body.toLowerCase().split(/\s+/)[0];
  if (!jid || !body.startsWith(prefix)) return;
  if (cmd === prefix+"uptime") {
    const seconds = Math.floor(process.uptime());
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    return sock.sendMessage(jid, { text: "⏳ Uptime: " + h + "h " + m + "m " + s + "s" }, { quoted: message });
  }
  if (cmd === prefix+"fastmode") {
    return sock.sendMessage(jid, { text: "⚡ Fast Mode: " + (config.fastMode ? "ON" : "OFF") }, { quoted: message });
  }
  if (cmd === prefix+"loadavg") {
    const load = os.loadavg().map(v => v.toFixed(2));
    return sock.sendMessage(jid, { text: "📊 Load average\n1m: "+load[0]+"\n5m: "+load[1]+"\n15m: "+load[2] }, { quoted: message });
  }
}
