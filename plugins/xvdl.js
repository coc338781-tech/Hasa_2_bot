import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFile);
const MAX_BYTES = 500 * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 1;
const MIN_FREE_BYTES = 1536 * 1024 * 1024;
const MAX_RESULTS = 20;
const SESSION_TTL = 15 * 60 * 1000;
const sessions = new Map();
const ageConfirmed = new Set();
let activeDownloads = 0;

export const commands = [
  { name: "xvdl", category: "3", usage: "xvdl", description: "Public adult video browser (18+ only; 500 MB limit)" }
];

const PORNHUB_CATEGORIES = [
  ["Amateur", "amateur"],
  ["Cosplay", "cosplay"],
  ["Mature", "mature"],
  ["Lesbian", "lesbian"],
  ["Solo", "solo"]
];

function getBody(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}

function getSender(message) {
  return message.key?.participant || message.key?.remoteJid || "";
}

function isOwner(message, sender, config) {
  if (message.key?.fromMe) return true;
  const number = String(sender).split("@")[0].split(":")[0].replace(/\D/g, "");
  return (Array.isArray(config.owner) ? config.owner : [config.owner])
    .filter(Boolean)
    .some(item => String(item).replace(/\D/g, "") === number);
}

function send(sock, jid, text, message) {
  return sock.sendMessage(jid, { text }, message ? { quoted: message } : {});
}

function getSession(key) {
  const session = sessions.get(key);
  if (!session) return null;
  if (Date.now() - session.updatedAt > SESSION_TTL) {
    sessions.delete(key);
    return null;
  }
  session.updatedAt = Date.now();
  return session;
}

function setSession(key, state) {
  sessions.set(key, { ...state, updatedAt: Date.now() });
}

function sourceMenu() {
  return [
    "╭━━〔 🔞 *HASA XVDL BROWSER* 〕━━",
    "┃",
    "┃ 1️⃣ Pornhub",
    "┃ 2️⃣ xHamster",
    "┃",
    "┃ අංකය Reply කරන්න.",
    "╰━━━━━━━━━━━━━━━━━━━━",
    "",
    "⚠️ 18+ වැඩිහිටියන්ට පමණයි. Public content පමණක්."
  ].join("\n");
}

function categoryMenu() {
  return [
    "╭━━〔 🎬 *PORNHub CATEGORIES* 〕━━",
    ...PORNHUB_CATEGORIES.map(([label], index) => "┃ " + (index + 1) + "️⃣ " + label),
    "┃ 6️⃣ Latest uploads",
    "┃ 7️⃣ Most viewed",
    "┃ 8️⃣ Top rated",
    "┃ 9️⃣ Search keyword",
    "╰━━━━━━━━━━━━━━━━━━━━",
    "",
    "Category අංකය Reply කරන්න."
  ].join("\n");
}

function xhamsterMenu() {
  return [
    "╭━━〔 🎬 *xHAMSTER BROWSER* 〕━━",
    "┃ 1️⃣ Latest uploads (Amateur feed)",
    "┃ 2️⃣ Trending / Popular (Amateur feed)",
    "┃ 3️⃣ Amateur",
    "┃ 4️⃣ Lesbian",
    "┃ 5️⃣ MILF",
    "┃ 6️⃣ Massage",
    "┃ 7️⃣ Search keyword",
    "╰━━━━━━━━━━━━━━━━━━━━",
    "",
    "අංකය Reply කරන්න."
  ].join("\n");
}

function formatSize(bytes, approximate = false) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "Size නොදනී";
  return (approximate ? "≈ " : "") + (Number(bytes) / (1024 * 1024)).toFixed(1) + " MB";
}

function getVideoSize(details) {
  if (Number(details.filesize) > 0) return { size: Number(details.filesize), approximate: false };
  if (Number(details.filesize_approx) > 0) return { size: Number(details.filesize_approx), approximate: true };
  const formats = Array.isArray(details.formats) ? details.formats : [];
  const candidates = formats.filter(format => format.vcodec && format.vcodec !== "none" &&
    (!format.height || format.height <= 1080));
  const pool = candidates.length ? candidates : formats.filter(format =>
    format.vcodec && format.vcodec !== "none" && (!format.height || format.height <= 1080));
  pool.sort((a, b) => (b.height || 0) - (a.height || 0) ||
    (b.tbr || b.vbr || 0) - (a.tbr || a.vbr || 0));
  const selected = pool.find(format => Number(format.filesize) > 0 || Number(format.filesize_approx) > 0);
  if (selected) return {
    size: Number(selected.filesize || selected.filesize_approx),
    approximate: !Number(selected.filesize)
  };
  const bitrateFormat = pool.find(format => Number(format.tbr || format.vbr) > 0);
  const duration = Number(details.duration);
  const bitrate = Number(bitrateFormat?.tbr || bitrateFormat?.vbr);
  if (bitrate > 0 && duration > 0) {
    return { size: bitrate * 1000 / 8 * duration, approximate: true };
  }
  return { size: null, approximate: false };
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) return "දිග නොදනී";
  const value = Math.floor(Number(seconds));
  return Math.floor(value / 60) + ":" + String(value % 60).padStart(2, "0");
}

function normalizeAllowedUrl(value, source) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (source === "pornhub" && host !== "pornhub.com") return null;
  if (source === "xhamster" && host !== "xhamster.com") return null;
  if (source === "xhamster" && !/^\/(videos(?:\/|$)|categories\/|search\/|users\/[^/]+\/videos|creators\/)/i.test(url.pathname)) return null;
  return url.toString();
}

function decodeHtml(value) {
  return String(value || "").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function htmlAttribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i"));
  return match ? decodeHtml(match[2]).trim() : "";
}

function titleFromVideoUrl(url) {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() || "Public video";
  return slug.replace(/-xh[a-z0-9]+$/i, "").replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ").trim().replace(/\b\w/g, letter => letter.toUpperCase()).slice(0, 100) || "Public video";
}

async function fetchXHamsterListing(url, execCommand) {
  const page = await execCommand("curl", [
    "-4", "-L", "-sS", "--fail", "--compressed", "--max-time", "25",
    "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36",
    url
  ], { timeout: 30000, maxBuffer: 6 * 1024 * 1024 });
  const html = String(page.stdout || "");
  const found = new Map();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const href = htmlAttribute(match[1], "href");
    if (!href) continue;
    let candidate;
    try { candidate = new URL(href.replace(/\\\//g, "/"), url).toString(); } catch { continue; }
    const safeUrl = normalizeAllowedUrl(candidate, "xhamster");
    if (!safeUrl || !/^https:\/\/(?:www\.)?xhamster\.com\/videos\/[^/?#]+/i.test(safeUrl)) continue;
    if (found.has(safeUrl)) continue;
    const inner = match[2] || "";
    const image = inner.match(/<img\b([^>]*)>/i);
    const title = htmlAttribute(match[1], "title") ||
      htmlAttribute(match[1], "aria-label") ||
      htmlAttribute(match[1], "data-title") ||
      (image ? htmlAttribute(image[1], "alt") : "") ||
      decodeHtml(inner.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()) ||
      titleFromVideoUrl(safeUrl);
    found.set(safeUrl, { title: String(title).replace(/[\r\n]/g, " ").slice(0, 100), url: safeUrl, size: null, duration: null });
    if (found.size >= MAX_RESULTS) break;
  }
  if (!found.size) {
    const fallbackPattern = /(?:https?:\\?\/\\?\/(?:www\\?\.)?xhamster\\?\.com)?\\?\/videos\\?\/[a-z0-9-]+-xh[a-z0-9]+/gi;
    for (const match of html.matchAll(fallbackPattern)) {
      const candidate = match[0].replace(/\\\//g, "/");
      const safeUrl = normalizeAllowedUrl(candidate.startsWith("http") ? candidate : "https://xhamster.com" + candidate, "xhamster");
      if (safeUrl && !found.has(safeUrl)) found.set(safeUrl, {
        title: titleFromVideoUrl(safeUrl), url: safeUrl, size: null, duration: null
      });
      if (found.size >= MAX_RESULTS) break;
    }
  }
  const entries = [...found.values()].slice(0, MAX_RESULTS);
  if (!entries.length) throw new Error("No public xHamster video links found in the listing.");
  // Resolve metadata in small batches. A failed metadata lookup does not discard
  // a public listing entry; the actual download is validated when selected.
  for (let index = 0; index < entries.length; index += 3) {
    await Promise.all(entries.slice(index, index + 3).map(async entry => {
      try {
        const metadata = await execCommand("yt-dlp", [
          "--skip-download", "--dump-single-json", "--no-warnings", "--no-playlist", entry.url
        ], { timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
        const details = JSON.parse(metadata.stdout || "{}");
        entry.title = String(details.title || entry.title).replace(/[\r\n]/g, " ").slice(0, 100);
        const measured = getVideoSize(details);
        entry.size = measured.size;
        entry.sizeApproximate = measured.approximate;
        entry.duration = details.duration || null;
      } catch {
        // Keep the public URL and a readable slug-derived title.
      }
    }));
  }
  return entries;
}

async function fetchListing(url, source, execCommand) {
  if (source === "xhamster") {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error("Invalid xHamster URL."); }
    // Category, search, home and creator pages are ordinary public HTML pages;
    // yt-dlp does not provide a playlist extractor for these listing URLs.
    if (!/^\/videos\/[^/]+/i.test(parsed.pathname)) {
      return fetchXHamsterListing(url, execCommand);
    }
  }
  const result = await execCommand("yt-dlp", [
    "--flat-playlist", "--dump-single-json", "--no-warnings",
    "--playlist-end", String(MAX_RESULTS), url
  ], { timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
  const info = JSON.parse(result.stdout || "{}");
  const rawEntries = Array.isArray(info.entries) ? info.entries.filter(Boolean) : [info];
  const entries = rawEntries.slice(0, MAX_RESULTS).map(entry => ({
    title: String(entry.title || "Untitled video").replace(/[\r\n]/g, " ").slice(0, 100),
    url: normalizeAllowedUrl(entry.webpage_url || entry.original_url || entry.url || "", source),
    size: entry.filesize_approx || entry.filesize || null,
    duration: entry.duration
  })).filter(entry => entry.url);
  for (let index = 0; index < entries.length; index += 3) {
    await Promise.all(entries.slice(index, index + 3).map(async entry => {
      if (Number.isFinite(Number(entry.size)) && Number(entry.size) > 0) return;
      try {
        const metadata = await execCommand("yt-dlp", [
          "--skip-download", "--dump-single-json", "--no-warnings", "--no-playlist", entry.url
        ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
        const details = JSON.parse(metadata.stdout || "{}");
        const formats = Array.isArray(details.formats) ? details.formats : [];
        const videoFormats = formats.filter(format => format.vcodec && format.vcodec !== "none" &&
          (!format.height || format.height <= 720));
        videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
        const selected = videoFormats[0] || {};
        const measured = getVideoSize(details);
        entry.size = measured.size || selected.filesize_approx || selected.filesize || null;
        entry.sizeApproximate = measured.approximate || (!selected.filesize && Number(selected.filesize_approx) > 0);
        entry.duration = details.duration || entry.duration;
      } catch {
        // Keep the entry visible and mark its size/duration as unavailable.
      }
    }));
  }
  return entries;
}

function listingFailureText(error, fallback) {
  const detail = String(error?.stderr || error?.message || "");
  if (/ECONNRESET|curl:\\s*\\(35\\)|connection reset|timed? out/i.test(detail)) {
    return "🌐 Website එකට යන connection එක අතරමඟදී reset වුණා.\n\n0️⃣ නැවත උත්සාහ කරන්න.\n6️⃣ Keyword search එකක් භාවිතා කරන්න.";
  }
  if (/HTTP Error 403|403 Forbidden|HTTP Error 429|Too Many Requests/i.test(detail)) {
    return "🌐 Website එක මේ request එක තාවකාලිකව ප්‍රතික්ෂේප කළා.\n\n0️⃣ නැවත උත්සාහ කරන්න.\n6️⃣ Keyword search එකක් භාවිතා කරන්න.";
  }
  return fallback;
}

function listingText(entries, source) {
  return [
    "╭━━〔 📺 *" + source + " VIDEO LIST* 〕━━",
    ...entries.map((entry, index) =>
      "┃ *" + (index + 1) + ".* " + entry.title +
      "\n┃    📦 " + formatSize(entry.size, entry.sizeApproximate) + " | ⏱️ " + formatDuration(entry.duration)
    ),
    "╰━━━━━━━━━━━━━━━━━━━━",
    "",
    "Download කිරීමට 1-" + entries.length + " අතර අංකය Reply කරන්න.",
    "➡️ තවත් වීඩියෝ සඳහා *N* | කලින් පිටුවට *P*",
    "📦 උපරිම ගොනු ප්‍රමාණය: *500 MB*"
  ].join("\n");
}

async function downloadVideo({ sock, jid, message, entry, config, execCommand, fileSystem }) {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    return send(sock, jid, "⏳ දැනට download එකක් ක්‍රියාත්මකයි. එය අවසන් වූ පසු නැවත උත්සාහ කරන්න.", message);
  }
  const url = normalizeAllowedUrl(entry.url, entry.source);
  if (!url) return send(sock, jid, "❌ මේ වීඩියෝ Link එක අවසර ලත් Public source එකකින් නොවේ.", message);
  activeDownloads++;
  const dir = path.resolve(config.downloadDir || "downloads");
  const name = "xvdl-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  try {
    fileSystem.mkdirSync(dir, { recursive: true });
    if (typeof fileSystem.statfsSync !== "function") {
      throw new Error("Disk free-space check is unavailable.");
    }
    const disk = fileSystem.statfsSync(dir);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes < MIN_FREE_BYTES) {
      await send(sock, jid, "⚠️ Server එකේ free disk space ප්‍රමාණවත් නැහැ. අවම 1.5 GB ඉඩක් ලැබුණු පසු නැවත උත්සාහ කරන්න.", message);
      return;
    }
    await send(sock, jid, "⏳ *Video එක Download කරමින්...*\n📦 උපරිමය 500 MB | එකවර download 1ක්", message);
    await execCommand("yt-dlp", ["--version"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    await execCommand("ffmpeg", ["-version"], { timeout: 15000, maxBuffer: 1024 * 1024 });
    await execCommand("yt-dlp", [
      "--no-playlist", "--no-warnings", "--max-filesize", "500M",
      "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
      "--merge-output-format", "mp4",
      "-o", path.join(dir, name + ".%(ext)s"), url
    ], { timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
    const files = fileSystem.readdirSync(dir)
      .filter(file => file.startsWith(name))
      .map(file => path.join(dir, file))
      .filter(file => fileSystem.existsSync(file) && fileSystem.statSync(file).isFile());
    if (!files.length) throw new Error("No output file was created.");
    const file = files[0];
    const size = fileSystem.statSync(file).size;
    if (size <= 0) throw new Error("Downloaded file is empty.");
    if (size > MAX_BYTES) throw new Error("Video is larger than 500 MB.");
    await sock.sendMessage(jid, {
      video: { url: file },
      caption: "✅ *XVDL DOWNLOAD COMPLETED*\n\n🎬 " + entry.title +
        "\n📦 " + formatSize(size) + "\n❤️ *POWERED BY HASA*"
    }, { quoted: message });
  } catch (error) {
    const reason = /larger than|max-filesize/i.test(String(error?.stderr || error?.message))
      ? "වීඩියෝ එක 500 MB සීමාව ඉක්මවයි."
      : error?.code === "ENOENT" && String(error?.path || "").includes("ffmpeg")
        ? "Server එකේ ffmpeg install කර නැහැ."
        : error?.code === "ENOENT"
          ? "Server එකේ yt-dlp install/update කළ යුතුයි."
          : "Public වීඩියෝ එක ලබාගැනීමට නොහැකි වුණා. Link එක අවහිර/Private විය හැක.";
    await send(sock, jid, "❌ *DOWNLOAD FAILED*\n" + reason, message).catch(() => {});
  } finally {
    try {
      for (const file of fileSystem.readdirSync(dir).filter(file => file.startsWith(name))) {
        try { fileSystem.unlinkSync(path.join(dir, file)); } catch {}
      }
    } catch {}
    activeDownloads--;
  }
}

export default async function xvdl({ sock, message, config, execCommand = exec, fileSystem = fs }) {
  const jid = message.key?.remoteJid;
  const sender = getSender(message);
  if (!jid || !sender) return;
  const body = getBody(message).trim();
  const prefix = config.prefix || ".";
  const commandMatch = body.match(new RegExp("^" + prefix.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&") + "xvdl(?:\\s+(.*))?$", "i"));
  const owner = isOwner(message, sender, config);
  const senderKey = sender;

  if (commandMatch) {
    if (!owner && !ageConfirmed.has(senderKey)) {
      setSession(senderKey, { step: "age" });
      return send(sock, jid,
        "🔞 *18+ AGE CONFIRMATION*\n\nමේ පහසුකම වයස අවුරුදු 18 හෝ ඊට වැඩි අයට පමණයි.\nඔබ වයස 18+ නම් *18* ලෙස Reply කරන්න. 18ට අඩු නම් භාවිතා නොකරන්න.", message);
    }
    setSession(senderKey, { step: "source" });
    return send(sock, jid, sourceMenu(), message);
  }

  const state = getSession(senderKey);
  if (!state) return;
  if (state.step === "age") {
    if (body === "18" || body.toLowerCase() === "yes") {
      ageConfirmed.add(senderKey);
      setSession(senderKey, { step: "source" });
      return send(sock, jid, "✅ ඔබ 18+ බව තහවුරු කළා.\n\n" + sourceMenu(prefix), message);
    }
    if (["no", "නැහැ", "නැ"].includes(body.toLowerCase())) {
      sessions.delete(senderKey);
      return send(sock, jid, "මෙම පහසුකම 18ට අඩු අයට ලබාගත නොහැක.", message);
    }
    return send(sock, jid, "ඉදිරියට යාමට 18+ නම් *18* ලෙස Reply කරන්න.", message);
  }
  if (state.step === "source") {
    if (body === "1") {
      setSession(senderKey, { step: "category", source: "pornhub" });
      return send(sock, jid, categoryMenu(), message);
    }
    if (body === "2") {
      setSession(senderKey, { step: "xhamster-browse", source: "xhamster" });
      return send(sock, jid, xhamsterMenu(), message);
    }
    return send(sock, jid, "1 හෝ 2 තෝරන්න.", message);
  }
  if (state.step === "xhamster-browse") {
    if (body === "7") {
      setSession(senderKey, { step: "xhamster-search", source: "xhamster" });
      return send(sock, jid, "🔎 සෙවීමට keyword එක යවන්න.", message);
    }
    const urls = state.retryUrl && body === "0" ? { "0": state.retryUrl } : {
      "1": "https://xhamster.com/categories/amateur?sort=newest",
      "2": "https://xhamster.com/categories/amateur?sort=best",
      "3": "https://xhamster.com/categories/amateur?sort=newest",
      "4": "https://xhamster.com/categories/lesbian?sort=newest",
      "5": "https://xhamster.com/categories/milf?sort=newest",
      "6": "https://xhamster.com/categories/massage?sort=newest"
    };
    const url = urls[body];
    if (!url) return send(sock, jid, "1-7 අතර අංකයක් තෝරන්න.", message);
    try {
      const entries = await fetchListing(url, "xhamster", execCommand);
      if (!entries.length) throw new Error("No public entries found.");
      setSession(senderKey, { step: "video", source: "xhamster", entries, listingUrl: url, page: 1 });
      return send(sock, jid, listingText(entries, "xHamster"), message);
    } catch (error) {
      setSession(senderKey, { step: "xhamster-browse", source: "xhamster", retryUrl: url });
      return send(sock, jid, "❌ " + listingFailureText(error, "xHamster public ලැයිස්තුව ලබාගත නොහැකි වුණා.") + "\\n\\n0️⃣ Retry", message);
    }
  }
  if (state.step === "xhamster-search") {
    if (!body || body.length > 80) return send(sock, jid, "කෙටි Search keyword එකක් යවන්න.", message);
    const url = "https://xhamster.com/search/" + encodeURIComponent(body);
    try {
      const entries = await fetchListing(url, "xhamster", execCommand);
      if (!entries.length) throw new Error("No public entries found.");
      setSession(senderKey, { step: "video", source: "xhamster", entries, listingUrl: url, page: 1 });
      return send(sock, jid, listingText(entries, "xHamster"), message);
    } catch (error) {
      return send(sock, jid, "❌ xHamster public search ලැයිස්තුව ලබාගත නොහැකි වුණා. " + listingFailureText(error, "පසුව නැවත උත්සාහ කරන්න."), message);
    }
  }
  if (state.step === "category") {
    let url;
    let fallbackUrl = null;
    let categoryLabel = state.categoryLabel || "";
    if (/^[1-5]$/.test(body)) {
      const [, slug] = PORNHUB_CATEGORIES[Number(body) - 1];
      url = "https://www.pornhub.com/categories/" + slug;
      fallbackUrl = "https://www.pornhub.com/video/search?search=" + encodeURIComponent(slug);
      categoryLabel = slug;
    } else if (body === "0" && state.retryUrl) {
      url = state.retryUrl;
      fallbackUrl = state.fallbackUrl || null;
    } else if (["6", "7", "8"].includes(body)) {
      url = {
        "6": "https://www.pornhub.com/video?o=mr",
        "7": "https://www.pornhub.com/video?o=mv",
        "8": "https://www.pornhub.com/video?o=tr"
      }[body];
    } else if (body === "9") {
      setSession(senderKey, { step: "pornhub-search", source: "pornhub" });
      return send(sock, jid, "🔎 සෙවීමට keyword එක යවන්න.", message);
    } else {
      return send(sock, jid, "ලැයිස්තුවෙන් 1-9 අතර අංකයක් තෝරන්න.", message);
    }
    try {
      let entries;
      let activeListingUrl = url;
      let listLabel = categoryLabel ? "Pornhub · " + categoryLabel : "Pornhub";
      try {
        entries = await fetchListing(url, state.source, execCommand);
        if (!entries.length) throw new Error("No public entries found.");
      } catch (primaryError) {
        if (!fallbackUrl) throw primaryError;
        entries = await fetchListing(fallbackUrl, state.source, execCommand);
        if (!entries.length) throw primaryError;
        activeListingUrl = fallbackUrl;
        listLabel += " (search fallback)";
      }
      setSession(senderKey, { step: "video", source: "pornhub", entries, listingUrl: activeListingUrl, page: 1 });
      return send(sock, jid, listingText(entries, listLabel), message);
    } catch (error) {
      setSession(senderKey, { step: "category", source: "pornhub", retryUrl: url, fallbackUrl, categoryLabel });
      return send(sock, jid, "❌ " + listingFailureText(error, "Public category එකේ වීඩියෝ ලැයිස්තුව ලබාගත නොහැකි වුණා.") + "\n\n0️⃣ Retry | 6️⃣ Search", message);
    }
  }
  if (state.step === "pornhub-search") {
    if (!body || body.length > 80) return send(sock, jid, "කෙටි Search keyword එකක් යවන්න.", message);
    const url = "https://www.pornhub.com/video/search?search=" + encodeURIComponent(body);
    try {
      const entries = await fetchListing(url, state.source, execCommand);
      if (!entries.length) throw new Error("No public entries found.");
      setSession(senderKey, { step: "video", source: "pornhub", entries, listingUrl: url, page: 1 });
      return send(sock, jid, listingText(entries, "Pornhub"), message);
    } catch {
      return send(sock, jid, "❌ Public search results ලබාගත නොහැකි වුණා. පසුව උත්සාහ කරන්න.", message);
    }
  }
  if (state.step === "xhamster-url") {
    const url = normalizeAllowedUrl(body, "xhamster");
    if (!url) return send(sock, jid, "නිවැරදි Public xHamster video හෝ creator profile URL එකක් යවන්න.", message);
    try {
      const entries = await fetchListing(url, state.source, execCommand);
      if (!entries.length) throw new Error("No public entries found.");
      setSession(senderKey, { step: "video", source: "xhamster", entries, listingUrl: url, page: 1 });
      return send(sock, jid, listingText(entries, "xHamster"), message);
    } catch {
      return send(sock, jid, "❌ මේ Public page එකෙන් වීඩියෝ ලැයිස්තුව ලබාගත නොහැකි වුණා.", message);
    }
  }
  if (state.step === "video") {
    if (["n", "next", "ඊළඟ"].includes(body.toLowerCase())) {
      const nextPage = (state.page || 1) + 1;
      const nextUrl = new URL(state.listingUrl);
      nextUrl.searchParams.set("page", String(nextPage));
      try {
        const entries = await fetchListing(nextUrl.toString(), state.source, execCommand);
        if (!entries.length) return send(sock, jid, "තවත් වීඩියෝ නැහැ. කලින් පිටුවට *P* යවන්න.", message);
        setSession(senderKey, { ...state, entries, page: nextPage });
        return send(sock, jid, listingText(entries, state.source === "xhamster" ? "xHamster · Page " + nextPage : "Pornhub · Page " + nextPage), message);
      } catch {
        return send(sock, jid, "ඊළඟ පිටුව ලබාගත නොහැකි වුණා. නැවත *N* යවන්න.", message);
      }
    }
    if (["p", "prev", "previous"].includes(body.toLowerCase())) {
      const previousPage = Math.max(1, (state.page || 1) - 1);
      if (previousPage === (state.page || 1)) return send(sock, jid, "ඔබ දැනට පළමු පිටුවේ ඉන්නේ.", message);
      const previousUrl = new URL(state.listingUrl);
      if (previousPage === 1) previousUrl.searchParams.delete("page");
      else previousUrl.searchParams.set("page", String(previousPage));
      try {
        const entries = await fetchListing(previousUrl.toString(), state.source, execCommand);
        setSession(senderKey, { ...state, entries, page: previousPage });
        return send(sock, jid, listingText(entries, state.source === "xhamster" ? "xHamster · Page " + previousPage : "Pornhub · Page " + previousPage), message);
      } catch {
        return send(sock, jid, "කලින් පිටුව ලබාගත නොහැකි වුණා.", message);
      }
    }
    if (!/^(?:[1-9]|1\d|20)$/.test(body)) return send(sock, jid, "1-" + state.entries.length + " අංකයක් තෝරන්න. තවත් වීඩියෝ සඳහා N යවන්න.", message);
    const entry = state.entries[Number(body) - 1];
    if (!entry) return send(sock, jid, "වැරදි වීඩියෝ අංකයක්.", message);
    sessions.delete(senderKey);
    return downloadVideo({
      sock, jid, message, entry: { ...entry, source: state.source },
      config, execCommand, fileSystem
    });
  }
}

export function resetXvdlStateForTests() {
  sessions.clear();
  ageConfirmed.clear();
  activeDownloads = 0;
}
