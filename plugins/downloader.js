import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
const exec = promisify(execFile);
export default async function downloader({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  const body = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  const command = body.startsWith(prefix) ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : "";
  if (!["dl", "fb"].includes(command)) return;
  const url = body.trim().slice((prefix + command).length).trim();
  if (!/^https?:\/\//i.test(url)) {
    return sock.sendMessage(jid, { text: "Usage: " + prefix + command + " https://..." }, { quoted: message });
  }
  const dir = path.resolve(config.downloadDir || "downloads");
  fs.mkdirSync(dir, { recursive: true });
  const prefixName = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  await sock.sendMessage(jid, { text: "⏳ Downloading..." }, { quoted: message });
  try {
    await exec("yt-dlp", [
      "--no-playlist", "--no-warnings", "--max-filesize", "64M",
      "-f", "best[ext=mp4][filesize<64M]/best[filesize<64M]/best",
      "--merge-output-format", "mp4",
      "-o", path.join(dir, prefixName + ".%(ext)s"), url
    ], { timeout: 240000, maxBuffer: 8 * 1024 * 1024 });
    const files = fs.readdirSync(dir)
      .filter(name => name.startsWith(prefixName))
      .map(name => path.join(dir, name))
      .filter(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (!files.length) throw new Error("yt-dlp finished but no output file was found.");
    const file = files[0];
    const data = fs.readFileSync(file);
    if (data.length > 64 * 1024 * 1024) throw new Error("Video is larger than 64 MB.");
    await sock.sendMessage(jid, { video: data, caption: path.basename(file) }, { quoted: message });
  } catch (error) {
    const reason = error.code === "ENOENT" ? "yt-dlp or ffmpeg is not installed." : error.message;
    await sock.sendMessage(jid, { text: "❌ Download failed: " + reason }, { quoted: message });
  } finally {
    for (const name of fs.readdirSync(dir).filter(name => name.startsWith(prefixName))) {
      try { fs.unlinkSync(path.join(dir, name)); } catch {}
    }
  }
}
