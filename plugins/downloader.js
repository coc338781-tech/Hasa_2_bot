import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { checkDownloaderTools } from "../lib/downloader-check.js";

const exec = promisify(execFile);
const MAX_BYTES = 96 * 1024 * 1024;

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
  if (/max-filesize|file is larger|larger than/i.test(details)) return "ගොනුවේ ප්‍රමාණය අවසර ලත් සීමාව ඉක්මවා ඇත (Video 96 MB / Audio 32 MB).";
  if (/429|too many requests|rate.?limit/i.test(details)) return "වෙබ් අඩවියෙන් තාවකාලික සීමාවක් දමා තිබෙනවා. ටික වේලාවකින් නැවත උත්සාහ කරන්න.";
  return "වීඩියෝ එක ලබාගැනීමේදී දෝෂයක් ඇති වුණා. Link එක Public ද කියලා පරීක්ෂා කර නැවත උත්සාහ කරන්න.";
}

export default async function downloader({ sock, message, config, execCommand = exec, fileSystem = fs }) {
  const jid = message.key?.remoteJid;
  if (!jid) return;
  const body = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  const command = body.startsWith(prefix) ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : "";
  if (command === "fbtest") {
    const checks = await checkDownloaderTools(exec);
    const lines = checks.map(item => (item.ok ? "✅ " : "❌ ") + item.name + ": " + (item.ok ? item.version : item.reason));
    return sock.sendMessage(jid, { text: "🧪 *DOWNLOADER DIAGNOSTIC*\n" + lines.join("\n") + "\n\nමෙය server tools පමණක් පරීක්ෂා කරයි; Facebook link එකක් download කරලා බලන්නේ නැහැ." }, { quoted: message });
  }
  if (!["dl", "fb", "video", "song"].includes(command)) return;

  const input = body.trim().slice((prefix + command).length).trim();
  const isAudio = command === "song";
  const supportsSearch = command === "video" || isAudio;
  if (!input) {
    return sock.sendMessage(jid, {
      text: "⚠️ *භාවිතය:* " + prefix + command + (supportsSearch ? " song name / public URL" : " https://...")
    }, { quoted: message });
  }
  if (!supportsSearch && !/^https?:\/\//i.test(input)) {
    return sock.sendMessage(jid, {
      text: "⚠️ *INVALID LINK*\n\nනිවැරදි Public URL එකක් යවන්න.\nඋදා: " + prefix + command + " https://..."
    }, { quoted: message });
  }
  const target = supportsSearch && !/^https?:\/\//i.test(input) ? "ytsearch1:" + input : input;
  const sizeLimit = isAudio ? 32 * 1024 * 1024 : MAX_BYTES;
  const dir = path.resolve(config.downloadDir || "downloads");
  fileSystem.mkdirSync(dir, { recursive: true });
  const prefixName = Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  try {
    await sock.sendMessage(jid, {
      text: "╭─「 ⏳ *" + (isAudio ? "SONG" : "VIDEO") + " DOWNLOADING* 」\n│\n│ 🔎 " + (supportsSearch && !/^https?:\/\//i.test(input) ? "Search කරමින්..." : "Link එක පරීක්ෂා කරමින්...") + "\n│ " + (isAudio ? "🎵 Audio එක සූදානම් කරමින්" : "🎬 වීඩියෝ එක සූදානම් කරමින්") + "\n│\n│ ❤️ පොඩ්ඩක් රැඳී සිටින්න.\n╰──────────────"
    }, { quoted: message });

    await execCommand("yt-dlp", ["--version"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    await execCommand("ffmpeg", ["-version"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    const downloadArgs = [
      "--no-playlist", "--no-warnings", "--max-downloads", "1",
      "--max-filesize", isAudio ? "32M" : "96M", 
      ...(isAudio
        ? ["-x", "--audio-format", "mp3", "--audio-quality", "5"]
        : ["-f", "best[ext=mp4][filesize<96M]/best[filesize<96M]/best[height<=720]/best[height<=480]", "--merge-output-format", "mp4"]),
      "-o", path.join(dir, prefixName + ".%(ext)s"), target
    ];
    await execCommand("yt-dlp", downloadArgs, { timeout: 240000, maxBuffer: 8 * 1024 * 1024 });

    const files = fileSystem.readdirSync(dir)
      .filter(name => name.startsWith(prefixName))
      .map(name => path.join(dir, name))
      .filter(file => fileSystem.existsSync(file) && fileSystem.statSync(file).isFile());
    if (!files.length) throw new Error("yt-dlp finished but no output file was found.");

    const file = files[0];
    const size = fileSystem.statSync(file).size;
    if (size <= 0) throw new Error("Downloaded file is empty.");
    if (size > sizeLimit) throw new Error(isAudio ? "Audio is larger than 32 MB." : "Video is larger than 96 MB.");
    const data = fileSystem.readFileSync(file);
    if (isAudio) {
      await sock.sendMessage(jid, { audio: data, mimetype: "audio/mpeg", fileName: path.basename(file) }, { quoted: message });
    } else {
      await sock.sendMessage(jid, {
        video: data,
        caption: "✅ *DOWNLOAD COMPLETED*\n\n🎬 " + path.basename(file) + "\n📦 " + (size / (1024 * 1024)).toFixed(1) + " MB\n❤️ *POWERED BY HASA*"
      }, { quoted: message });
    }
  } catch (error) {
    const reason = explainDownloadError(error);
    await sock.sendMessage(jid, {
      text: "╭─「 ❌ *DOWNLOAD FAILED* 」\n│\n│ Download එක ලබාගන්න බැරි වුණා.\n│\n│ 🔎 *හේතුව:*\n│ " + reason + "\n│\n│ 🔄 වෙනත් Public Link එකක් උත්සාහ කරන්න.\n╰──────────────"
    }, { quoted: message }).catch(() => {});
  } finally {
    for (const name of fileSystem.readdirSync(dir).filter(name => name.startsWith(prefixName))) {
      try { fileSystem.unlinkSync(path.join(dir, name)); } catch {}
    }
  }
}
