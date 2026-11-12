import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { checkDownloaderTools } from "../lib/downloader-check.js";

const exec = promisify(execFile);
const MAX_BYTES = 200 * 1024 * 1024;

export function safeDownloadDiagnostic(error) {
  const candidates = [error?.stderr, error?.stdout, error?.message]
    .filter(value => typeof value === "string" && value.trim());
  let line = "";
  for (const source of candidates) {
    const lines = source.split(/\r?\n/).filter(Boolean);
    const useful = lines.filter(item => /error|unable|unsupported|private|login|sign.?in|not available|http error|extractor|failed|403|404|429|rate.?limit|command failed|enoent|larger than|empty/i.test(item));
    line = useful.at(-1) || lines.at(-1) || "";
    if (line) break;
  }
  line = line
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL REDACTED]")
    .replace(/(cookie|authorization|token|password|session)([=: ]+)(?:Bearer\s+)?\S+/gi, "$1$2[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b\d{8,}\b/g, "[NUMBER REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (!line && error?.code) line = "Process error code: " + String(error.code).slice(0, 40);
  return line.slice(0, 180) || "No safe diagnostic details were returned.";
}

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
  if (/sign in to confirm|confirm you.re not a bot|not a bot|login_required/i.test(details)) return "YouTube එක Oracle server IP එකෙන් bot verification ඉල්ලනවා. Authorized YouTube session cookies file එකක් secureව configure කළ යුතුයි; PO Token එක පමණක් IP restriction එක ඉවත් කරන්නේ නැහැ.";
  if (/private|login required|sign in|authentication|cookies/i.test(details)) return "මේ වීඩියෝ එක Private හෝ Login අවශ්‍ය එකක්. Public Link එකක් යවන්න."
  if (/geo.?restricted|not available in your country/i.test(details)) return "මේ වීඩියෝ එක ඔබේ ප්‍රදේශයෙන් ලබාගත නොහැක.";
  if (/max-filesize|file is larger|larger than/i.test(details)) return "ගොනුවේ ප්‍රමාණය අවසර ලත් සීමාව ඉක්මවා ඇත (Video 200 MB / Audio 32 MB).";
  if (/429|too many requests|rate.?limit/i.test(details)) return "වෙබ් අඩවියෙන් තාවකාලික සීමාවක් දමා තිබෙනවා. ටික වේලාවකින් නැවත උත්සාහ කරන්න.";
  return "වීඩියෝ එක ලබාගැනීමේදී දෝෂයක් ඇති වුණා. Link එක Public ද කියලා පරීක්ෂා කර නැවත උත්සාහ කරන්න.";
}


function youtubeOptions(target, fileSystem = fs) {
  const value = String(target);
  const isYoutube = value.startsWith("ytsearch") ||
    /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(value);
  const cookieFile = process.env.YOUTUBE_COOKIES_FILE;
  const cookies = cookieFile && fileSystem.existsSync(cookieFile) ? ["--cookies", cookieFile] : [];
  return [...(isYoutube ? ["--extractor-args", "youtube:player_client=tv,web_safari"] : []), ...cookies];
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
    const supplied = body.trim().slice((prefix + command).length).trim();
    const links = supplied.match(/https?:\/\/[^\s]+/gi) || [];
    if (links.length) {
      const results = [];
      for (const link of links.slice(0, 3)) {
        try {
          const result = await exec("yt-dlp", ["--simulate", "--skip-download", "--dump-single-json", "--no-warnings", "--no-playlist", ...youtubeOptions(link, fileSystem), link], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
          const info = JSON.parse(result.stdout || "{}");
          results.push("✅ " + (info.extractor_key || info.extractor || "Extractor") + " | " + String(info.title || "Title unavailable").slice(0, 90) + " | " + (Array.isArray(info.formats) ? info.formats.length + " formats" : "metadata received"));
        } catch (error) {
          results.push("❌ " + explainDownloadError(error) + "\n   Diagnostic: " + safeDownloadDiagnostic(error));
        }
      }
      return sock.sendMessage(jid, { text: "🧪 *FACEBOOK LINK TEST*\n" + lines.join("\n") + "\n\n" + results.map((result, i) => "Link " + (i + 1) + ":\n" + result).join("\n\n") + "\n\nමෙය download නොකර link/extractor පමණක් පරීක්ෂා කරයි." }, { quoted: message });
    }
    return sock.sendMessage(jid, { text: "🧪 *DOWNLOADER DIAGNOSTIC*\n" + lines.join("\n") + "\n\nFacebook link එකක් පරීක්ෂා කිරීමට .fbtest https://... ලෙස යවන්න." }, { quoted: message });
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
      "--no-playlist", "--no-warnings",
      ...youtubeOptions(target, fileSystem),
      ...(isAudio
        ? ["--max-filesize", "32M", "-x", "--audio-format", "mp3", "--audio-quality", "5"]
        : ["-f", "best[ext=mp4][height<=480]/best[height<=480]/best[height<=720]/best", "--merge-output-format", "mp4"]),
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
    if (size > sizeLimit) throw new Error(isAudio ? "Audio is larger than 32 MB." : "Video is larger than 200 MB.");
    if (isAudio) {
      await sock.sendMessage(jid, { audio: { url: file }, mimetype: "audio/mpeg", fileName: path.basename(file) }, { quoted: message });
    } else {
      await sock.sendMessage(jid, {
        video: { url: file },
        caption: "✅ *DOWNLOAD COMPLETED*\n\n🎬 " + path.basename(file) + "\n📦 " + (size / (1024 * 1024)).toFixed(1) + " MB\n❤️ *POWERED BY HASA*"
      }, { quoted: message });
    }
  } catch (error) {
    const reason = explainDownloadError(error);
    await sock.sendMessage(jid, {
      text: "╭─「 ❌ *DOWNLOAD FAILED* 」\n│\n│ Download එක ලබාගන්න බැරි වුණා.\n│\n│ 🔎 *හේතුව:*\n│ " + reason + "\n│\n│ 🧪 *Diagnostic:*\n│ " + safeDownloadDiagnostic(error) + "\n│\n│ 🔄 වෙනත් Public Link එකක් උත්සාහ කරන්න.\n╰──────────────"
    }, { quoted: message }).catch(() => {});
  } finally {
    for (const name of fileSystem.readdirSync(dir).filter(name => name.startsWith(prefixName))) {
      try { fileSystem.unlinkSync(path.join(dir, name)); } catch {}
    }
  }
}
