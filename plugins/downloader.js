import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFile);
const MAX_BYTES = 64 * 1024 * 1024;

export function explainDownloadError(error) {
  const details = [error?.stderr, error?.message].filter(Boolean).join("\n").toLowerCase();
  if (error?.code === "ENOENT") {
    const command = String(error?.path || error?.spawnargs?.[0] || "").toLowerCase();
    return command.includes("ffmpeg")
      ? "Server එකේ ffmpeg ස්ථාපනය කර නැහැ. Admin කෙනෙකුට ffmpeg install කළ යුතුයි."
      : "Server එකේ yt-dlp හමු වුණේ නැහැ. Admin කෙනෙකුට yt-dlp install/update කළ යුතුයි.";
  }
  if (error?.killed || error?.signal === "SIGTERM" || /timed? ?out|timeout/i.test(details)) {
    return "Download එකට වැඩි වෙලාවක් ගත වූ නිසා නවතා දැමුවා. පසුව නැවත උත්සාහ කරන්න.";
  }
  if (/unsupported url|not a valid url|no suitable extractor/i.test(details)) return "මේ Link එක හඳුනාගන්න බැහැ. නිවැරදි Public වීඩියෝ Link එකක් යවන්න.";
  if (/private|login required|sign in|authentication|cookies/i.test(details)) return "මේ වීඩියෝ එක Private හෝ Login අවශ්‍ය එකක්. Public Link එකක් යවන්න.";
  if (/geo.?restricted|not available in your country/i.test(details)) return "මේ වීඩියෝ එක ඔබේ ප්‍රදේශයෙන් ලබාගත නොහැක.";
  if (/max-filesize|file is larger|larger than/i.test(details)) return "වීඩියෝ එක 64 MB සීමාවට වඩා විශාලයි.";
  if (/429|too many requests|rate.?limit/i.test(details)) return "වෙබ් අඩවියෙන් තාවකාලික සීමාවක් දමා තිබෙනවා. ටික වේලාවකින් නැවත උත්සාහ කරන්න.";
  return "වීඩියෝ එක ලබාගැනීමේදී දෝෂයක් ඇති වුණා. Link එක Public ද කියලා පරීක්ෂා කර නැවත උත්සාහ කරන්න.";
}

export default async function downloader({ sock, message, config, execCommand = exec, fileSystem = fs }) {
  const jid = message.key?.remoteJid;
  if (!jid) return;
  const body = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  const command = body.startsWith(prefix) ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : "";
  if (!["dl", "fb"].includes(command)) return;

  const url = body.trim().slice((prefix + command).length).trim();
  if (!/^https?:\/\//i.test(url)) {
    return sock.sendMessage(jid, {
      text: "⚠️ *INVALID LINK*\n\nකරුණාකර නිවැරදි වීඩියෝ Link එකක් යවන්න.\nඋදා: " + prefix + command + " https://..."
    }, { quoted: message });
  }

  const dir = path.resolve(config.downloadDir || "downloads");
  fileSystem.mkdirSync(dir, { recursive: true });
  const prefixName = Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  try {
    await sock.sendMessage(jid, {
      text: "╭─「 ⏳ *VIDEO DOWNLOADING* 」\n│\n│ 🔎 Link එක පරීක්ෂා කරමින්...\n│ 🎬 වීඩියෝ එක සූදානම් කරමින්\n│\n│ ❤️ පොඩ්ඩක් රැඳී සිටින්න.\n╰──────────────"
    }, { quoted: message });

    // Check both required server tools before starting a potentially long download.
    await execCommand("yt-dlp", ["--version"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    await execCommand("ffmpeg", ["-version"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    await execCommand("yt-dlp", [
      "--no-playlist", "--no-warnings", "--max-filesize", "64M",
      "-f", "best[ext=mp4][filesize<64M]/best[filesize<64M]/best",
      "--merge-output-format", "mp4",
      "-o", path.join(dir, prefixName + ".%(ext)s"), url
    ], { timeout: 240000, maxBuffer: 8 * 1024 * 1024 });

    const files = fileSystem.readdirSync(dir)
      .filter(name => name.startsWith(prefixName))
      .map(name => path.join(dir, name))
      .filter(file => fileSystem.existsSync(file) && fileSystem.statSync(file).isFile());
    if (!files.length) throw new Error("yt-dlp finished but no output file was found.");

    const file = files[0];
    const size = fileSystem.statSync(file).size;
    if (size <= 0) throw new Error("Downloaded file is empty.");
    if (size > MAX_BYTES) throw new Error("Video is larger than 64 MB.");
    const data = fileSystem.readFileSync(file);
    await sock.sendMessage(jid, {
      video: data,
      caption: "✅ *DOWNLOAD COMPLETED*\n\n🎬 " + path.basename(file) + "\n📦 " + (size / (1024 * 1024)).toFixed(1) + " MB\n❤️ *POWERED BY HASA*"
    }, { quoted: message });
  } catch (error) {
    const reason = explainDownloadError(error);
    await sock.sendMessage(jid, {
      text: "╭─「 ❌ *DOWNLOAD FAILED* 」\n│\n│ වීඩියෝ එක ලබාගන්න බැරි වුණා.\n│\n│ 🔎 *හේතුව:*\n│ " + reason + "\n│\n│ 🔄 වෙනත් Public Link එකක් උත්සාහ කරන්න.\n╰──────────────"
    }, { quoted: message }).catch(() => {});
  } finally {
    for (const name of fileSystem.readdirSync(dir).filter(name => name.startsWith(prefixName))) {
      try { fileSystem.unlinkSync(path.join(dir, name)); } catch {}
    }
  }
}
