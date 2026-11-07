import os from "node:os";

function formatBytes(bytes) {
  const mb = bytes / 1024 / 1024;
  return mb >= 100 ? mb.toFixed(0) : mb.toFixed(1);
}

function formatUptime(totalSeconds) {
  const seconds = Math.floor(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${String(hours).padStart(2, "0")} Hours, ${String(minutes).padStart(2, "0")} Mins, ${String(remainder).padStart(2, "0")} Secs`;
}

export default async function system({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  const body = (message.message?.conversation || message.message?.extendedTextMessage?.text || "").trim();
  const prefix = config.prefix || ".";
  const cmd = body.toLowerCase().split(/\\s+/)[0];
  if (!jid || !body.startsWith(prefix)) return;

  if (cmd === prefix + "system" || cmd === prefix + "ram") {
    const memory = process.memoryUsage();
    const totalRam = os.totalmem();
    const cpuCores = os.cpus()?.length || 1;
    const version = process.env.npm_package_version || "1.0.0";
    const uptime = formatUptime(process.uptime());

    const sysTxt =
      "⚙️ *HASA_2_BOT SYSTEM INFO* ⚙️\n\n" +
      `⏱️ *Uptime:* ${uptime}\n` +
      `💻 *OS:* ${os.platform()} (${os.arch()})\n` +
      `🧠 *CPU Cores:* ${cpuCores}\n` +
      `💾 *Bot RAM Usage:* ${formatBytes(memory.rss)} MB / ${formatBytes(totalRam)} MB\n` +
      `🔖 *Bot Version:* ${version}\n` +
      `🟢 *Node.js:* ${process.version}`;

    return sock.sendMessage(jid, { text: sysTxt }, { quoted: message });
  }

  if (cmd === prefix + "uptime") {
    return sock.sendMessage(
      jid,
      { text: "⏳ Uptime: " + formatUptime(process.uptime()) },
      { quoted: message }
    );
  }

  if (cmd === prefix + "fastmode") {
    return sock.sendMessage(
      jid,
      { text: "⚡ Fast Mode: " + (config.fastMode ? "ON" : "OFF") },
      { quoted: message }
    );
  }

  if (cmd === prefix + "loadavg") {
    const load = os.loadavg().map((value) => value.toFixed(2));
    return sock.sendMessage(
      jid,
      { text: "📊 Load average\\n1m: " + load[0] + "\\n5m: " + load[1] + "\\n15m: " + load[2] },
      { quoted: message }
    );
  }
}
