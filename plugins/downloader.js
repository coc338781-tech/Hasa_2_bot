import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFile);

function explainDownloadError(error) {
  const details = [error?.stderr, error?.message]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (error?.code === "ENOENT") {
    return "Downloader tool එක හමු වුණේ නැහැ. Server එකේ yt-dlp / ffmpeg PATH එක පරීක්ෂා කළ යුතුයි.";
  }
  if (error?.killed || error?.signal === "SIGTERM" || /timed? ?out|timeout/i.test(details)) {
    return "Download එකට වැඩි වෙලාවක් ගත වූ නිසා නවතා දැමුවා. පොඩි වීඩියෝ එකක Link එකක් නැවත උත්සාහ කරන්න.";
  }
  if (/unsupported url|not a valid url|no suitable extractor/i.test(details)) {
    return "මේ Link එක හඳුනාගන්න බැහැ. නිවැරදි සහ Public වීඩියෝ Link එකක් යවන්න.";
  }
  if (/private|login required|sign in|authentication|cookies/i.test(details)) {
    return "මේ වීඩියෝ එක Private හෝ Login අවශ්‍ය එකක්. Public Link එකක් යවන්න.";
  }
  if (/geo.?restricted|not available in your country/i.test(details)) {
    return "මේ වීඩියෝ එක ඔබේ ප්‍රදේශයෙන් ලබාගත නොහැක.";
  }
  if (/max-filesize|file is larger|larger than/i.test(details)) {
    return "Media එක 64 MB සීමාවට වඩා විශාලයි.";
  }
  if (/429|too many requests|rate.?limit/i.test(details)) {
    return "වෙබ් අඩවියෙන් තාවකාලික සීමාවක් දමා තිබෙනවා. ටික වේලාවකින් නැවත උත්සාහ කරන්න.";
  }
  return "වීඩියෝ එක ලබාගැනීමේදී දෝෂයක් ඇති වුණා. Link එක Public ද කියලා පරීක්ෂා කර නැවත උත්සාහ කරන්න.";
}

export default async function downloader({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  const body = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  const command = body.startsWith(prefix)
    ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase()
    : "";

  if (!["dl", "fb", "song", "mp3"].includes(command)) return;

  const url = body.trim().slice((prefix + command).length).trim();
  if (!/^https?:\/\//i.test(url)) {
    return sock.sendMessage(
      jid,
      { text: "⚠️ *INVALID LINK*\n\nකරුණාකර නිවැරදි Public Link එකක් යවන්න.\nඋදා: " + prefix + command + " https://..." },
      { quoted: message }
    );
  }

  const dir = path.resolve(config.downloadDir || "downloads");
  fs.mkdirSync(dir, { recursive: true });
  const prefixName = Date.now() + "-" + Math.random().toString(36).slice(2, 8);

  const audioMode = command === "song" || command === "mp3";
  await sock.sendMessage(
    jid,
    {
      text: audioMode
        ? "╭─「 ⏳ *AUDIO DOWNLOADING* 」\n│\n│ 🎵 Audio එක සූදානම් කරමින්\n│ පවතී...\n│\n│ ❤️ පොඩ්ඩක් රැඳී සිටින්න.\n╰──────────────"
        : "╭─「 ⏳ *VIDEO DOWNLOADING* 」\n│\n│ 🎬 වීඩියෝ එක සූදානම් කරමින්\n│ පවතී...\n│\n│ ❤️ පොඩ්ඩක් රැඳී සිටින්න.\n╰──────────────"
    },
    { quoted: message }
  );

  try {
    const downloadArgs = audioMode
      ? [
          "--no-playlist", "--no-warnings", "--max-filesize", "64M",
          "--extract-audio", "--audio-format", "mp3", "--audio-quality", "5",
          "-o", path.join(dir, prefixName + ".%(ext)s"), url
        ]
      : [
          "--no-playlist", "--no-warnings", "--max-filesize", "64M",
          "-f", "best[ext=mp4][filesize<64M]/best[filesize<64M]/best",
          "--merge-output-format", "mp4",
          "-o", path.join(dir, prefixName + ".%(ext)s"), url
        ];
    await exec("yt-dlp", downloadArgs, { timeout: 240000, maxBuffer: 8 * 1024 * 1024 });

    const files = fs.readdirSync(dir)
      .filter(name => name.startsWith(prefixName))
      .map(name => path.join(dir, name))
      .filter(file => fs.existsSync(file) && fs.statSync(file).isFile());

    if (!files.length) throw new Error("yt-dlp finished but no output file was found.");

    const file = files[0];
    const data = fs.readFileSync(file);
    if (data.length > 64 * 1024 * 1024) throw new Error("Media is larger than 64 MB.");

    if (audioMode) {
      await sock.sendMessage(
        jid,
        { audio: data, mimetype: "audio/mpeg", fileName: "Hasa-audio.mp3", ptt: false },
        { quoted: message }
      );
    } else {
      await sock.sendMessage(
        jid,
        { video: data, caption: "✅ *DOWNLOAD COMPLETED*\n\n🎬 " + path.basename(file) + "\n❤️ *POWERED BY HASA*" },
        { quoted: message }
      );
    }
  } catch (error) {
    const reason = explainDownloadError(error);
    await sock.sendMessage(
      jid,
      { text: "╭─「 ❌ *DOWNLOAD FAILED* 」\n│\n│ " + (audioMode ? "Audio" : "වීඩියෝ") + " එක ලබාගන්න බැරි වුණා.\n│\n│ 🔎 *හේතුව:*\n│ " + reason + "\n│\n│ 🔄 වෙනත් Public Link එකක් උත්සාහ කරන්න.\n╰──────────────" },
      { quoted: message }
    );
  } finally {
    for (const name of fs.readdirSync(dir).filter(name => name.startsWith(prefixName))) {
      try { fs.unlinkSync(path.join(dir, name)); } catch {}
    }
  }
}
