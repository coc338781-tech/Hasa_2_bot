import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, statfs } from "node:fs/promises";

const exec = promisify(execFile);

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "N/A";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return value.toFixed(unit >= 3 ? 2 : 1) + " " + units[unit];
}

export function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts = [];
  if (days) parts.push(days + "d");
  parts.push(String(hours).padStart(2, "0") + "h");
  parts.push(String(minutes).padStart(2, "0") + "m");
  parts.push(String(remainder).padStart(2, "0") + "s");
  return parts.join(" ");
}

async function readPackageVersion(path, fallback = "Unknown") {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    return data.version || fallback;
  } catch {
    return fallback;
  }
}

async function getCpuUsage() {
  try {
    const before = os.cpus().map(cpu => cpu.times);
    await new Promise(resolve => setTimeout(resolve, 150));
    const after = os.cpus().map(cpu => cpu.times);
    let totalDelta = 0;
    let idleDelta = 0;
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      const beforeTotal = Object.values(before[i]).reduce((sum, value) => sum + value, 0);
      const afterTotal = Object.values(after[i]).reduce((sum, value) => sum + value, 0);
      totalDelta += afterTotal - beforeTotal;
      idleDelta += after[i].idle - before[i].idle;
    }
    return totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : null;
  } catch {
    return null;
  }
}

async function getDiskInfo() {
  try {
    const disk = await statfs(process.cwd());
    const total = disk.blocks * disk.bsize;
    const free = disk.bavail * disk.bsize;
    const used = Math.max(0, total - free);
    const percent = total > 0 ? Math.round((used / total) * 100) : 0;
    return { total, free, used, percent };
  } catch {
    return null;
  }
}

async function getToolVersion(command, args) {
  try {
    const result = await exec(command, args, { timeout: 4000, maxBuffer: 64 * 1024 });
    const output = String(result.stdout || result.stderr || "").split("\\n")[0].trim();
    return output.slice(0, 90) || "Available";
  } catch {
    return "Unavailable";
  }
}

export async function buildSystemInfo({ sock, config }) {
  const cpus = os.cpus() || [];
  const memory = process.memoryUsage();
  const totalRam = os.totalmem();
  const freeRam = os.freemem();
  const usedRam = Math.max(0, totalRam - freeRam);
  const [disk, cpuUsage, ytDlpVersion, ffmpegVersion] = await Promise.all([\n    getDiskInfo(), getCpuUsage(), getToolVersion("yt-dlp", ["--version"]), getToolVersion("ffmpeg", ["-version"])\n  ]);
  const [botVersion, baileysVersion] = await Promise.all([
    readPackageVersion(new URL("../package.json", import.meta.url), process.env.npm_package_version || "1.0.0"),
    readPackageVersion(new URL("../node_modules/@whiskeysockets/baileys/package.json", import.meta.url))
  ]);
  const pluginCount = Number.isInteger(globalThis.__hasaPlugins?.count)
    ? globalThis.__hasaPlugins.count
    : null;
  const connection = sock?.user?.id ? "Connected" : "Connection status unavailable";
  const mode = config?.publicMode === false ? "Private" : "Public";
  const load = os.loadavg().map(value => value.toFixed(2));

  const lines = [
    "╭━━〔 🖥️ *" + (config?.botName || "HASA 2 BOT").toUpperCase() + " SYSTEM* 〕━━╮",
    "",
    "┏━━〔 ⚙️ *SERVER DETAILS* 〕",
    "┃ 🐧 OS: " + os.type() + " " + os.release(),
    "┃ 🧩 Platform: " + os.platform() + " / " + os.arch(),
    "┃ 🧠 CPU: " + (cpus[0]?.model?.trim() || "Unknown"),
    "┃ 🔢 CPU Cores: " + (cpus.length || "Unknown"),
    "┃ 📈 CPU Usage: " + (cpuUsage === null ? "Unavailable" : cpuUsage.toFixed(1) + "%"),
    "┃ 📊 Load Average: " + load.join(" / ") + " (1m / 5m / 15m)",
    "┃ ⏳ Server Uptime: " + formatUptime(os.uptime()),
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 💾 *MEMORY & STORAGE* 〕",
    "┃ RAM Used: " + formatBytes(usedRam) + " / " + formatBytes(totalRam),
    "┃ RAM Free: " + formatBytes(freeRam),
    "┃ Bot Memory: " + formatBytes(memory.rss) + " (process RSS)",
    "┃ Disk Used: " + (disk ? formatBytes(disk.used) + " / " + formatBytes(disk.total) + " (" + disk.percent + "%)" : "Unavailable"),
    "┃ Disk Free: " + (disk ? formatBytes(disk.free) : "Unavailable"),
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 🤖 *BOT DETAILS* 〕",
    "┃ Status: " + connection,
    "┃ Bot Uptime: " + formatUptime(process.uptime()),
    "┃ Version: " + botVersion,
    "┃ Node.js: " + process.version,
    "┃ Baileys: " + baileysVersion,
    "┃ Plugins: " + (pluginCount === null ? "Unknown" : pluginCount + " Active"),
    "┃ Mode: " + mode,
    "┃ Fast Mode: " + (config?.fastMode ? "ON ⚡" : "OFF"),
    "┗━━━━━━━━━━━━━━━━",
    "",
    "╰━━〔 *HASA 2 BOT • SYSTEM MONITOR* 〕━━╯"
  ];
  return lines.join("\n");
}

export default async function system({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  const body = (message.message?.conversation || message.message?.extendedTextMessage?.text || "").trim();
  const prefix = config.prefix || ".";
  const cmd = body.toLowerCase().split(/\s+/)[0];
  if (!jid || !body.startsWith(prefix)) return;

  if (cmd === prefix + "system" || cmd === prefix + "ram") {
    const sysTxt = await buildSystemInfo({ sock, config });
    return sock.sendMessage(jid, { text: sysTxt }, { quoted: message });
  }

  if (cmd === prefix + "uptime") {
    return sock.sendMessage(
      jid,
      { text: "⏳ Bot Uptime: " + formatUptime(process.uptime()) },
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
    const load = os.loadavg().map(value => value.toFixed(2));
    return sock.sendMessage(
      jid,
      { text: "📊 Server Load Average\n1m: " + load[0] + "\n5m: " + load[1] + "\n15m: " + load[2] },
      { quoted: message }
    );
  }
}
