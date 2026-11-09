import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { recordAiUsage } from "../lib/ai-usage.js";

const exec = promisify(execFile);
const DATA_DIR = path.resolve("./data");
const SCHEDULE_FILE = path.join(DATA_DIR, "scheduled-messages.json");
const timers = new Map();
let pending = [];
let schedulerLoaded = false;
let activeSocket = null;

export const commands = [
  { name: "search", category: "2", usage: "search <query>", description: "Search the live web and return useful links." },
  { name: "tts", category: "2", usage: "tts [si|en|ta] <text>", description: "Turn text into a spoken audio message." },
  { name: "pdf", category: "6", usage: "pdf (reply to PDF)", description: "Extract and summarize text from a PDF document." },
  { name: "ocr", category: "6", usage: "ocr (reply to image)", description: "Read and extract text from an image using AI." },
  { name: "topdf", category: "6", usage: "topdf (reply to image)", description: "Convert a photo into a PDF document." },
  { name: "qr", category: "10", usage: "qr <text or link>", description: "Create a QR code image from text or a URL." },
  { name: "vcard", category: "10", usage: "vcard Name | Number | Company", description: "Create a downloadable contact card (.vcf)." },
  { name: "aiusage", category: "8", usage: "aiusage", description: "Show private Gemini and Groq request counts and errors." },
  { name: "schedule", category: "5", usage: "schedule <10m|2h|1d> <number> | <message>", description: "Schedule an owner-only private WhatsApp message." },
  { name: "schedules", category: "5", usage: "schedules", description: "List pending scheduled messages (owner only)." },
  { name: "cancelschedule", category: "5", usage: "cancelschedule <id>", description: "Cancel a pending scheduled message (owner only)." }
];

function bodyOf(message) {
  return message.message?.conversation || message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption || message.message?.documentMessage?.caption || "";
}
function isOwner(message, jid, config) {
  if (message.key?.fromMe) return true;
  const number = String(message.key?.participant || jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(value => String(value).replace(/\D/g, "") === number);
}
function quotedMessage(message) {
  return message.message?.extendedTextMessage?.contextInfo?.quotedMessage || {};
}
function mediaFrom(message, key) {
  return message.message?.[key] || quotedMessage(message)?.[key] || null;
}
async function download(media, type, maxBytes = 12 * 1024 * 1024) {
  const stream = await downloadContentFromMessage(media, type);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("File එක 12 MB සීමාව ඉක්මවා ඇත.");
    chunks.push(chunk);
  }
  if (!size) throw new Error("Media data ලබාගත නොහැක.");
  return Buffer.concat(chunks);
}
function decodePdfString(value) {
  return value.replace(/\\([\\()])/g, "$1").replace(/\\n/g, "\n").replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t").replace(/\\b/g, "\b").replace(/\\f/g, "\f")
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}
function decodePdfHex(value) {
  const clean = value.replace(/\s/g, "");
  if (clean.length % 4 === 0 && clean.slice(0, 4).toUpperCase() === "FEFF") {
    const bytes = Buffer.from(clean, "hex");
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes.readUInt16BE(i));
    return out;
  }
  return Buffer.from(clean.length % 2 ? clean + "0" : clean, "hex").toString("latin1");
}
export function extractPdfText(buffer) {
  const raw = buffer.toString("latin1");
  if (!raw.startsWith("%PDF-")) throw new Error("මේ file එක වලංගු PDF එකක් නොවේ.");
  const chunks = [];
  const streamRegex = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRegex.exec(raw))) {
    let content = match[2];
    if (/\/FlateDecode/.test(match[1])) {
      try { content = inflateSync(Buffer.from(content, "latin1")).toString("latin1"); }
      catch { continue; }
    }
    const strings = [];
    content.replace(/\(((?:\\.|[^\\)])*)\)\s*Tj/g, (_, value) => { strings.push(decodePdfString(value)); return _; });
    content.replace(/<([0-9A-Fa-f\s]+)>\s*Tj/g, (_, value) => { strings.push(decodePdfHex(value)); return _; });
    content.replace(/\[((?:.|\n|\r)*?)\]\s*TJ/g, (_, array) => {
      for (const item of array.matchAll(/\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g)) {
        strings.push(item[1] !== undefined ? decodePdfString(item[1]) : decodePdfHex(item[2]));
      }
      return _;
    });
    if (strings.length) chunks.push(strings.join(" "));
  }
  return chunks.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
export function parseVCardInput(input) {
  const parts = String(input || "").split("|").map(part => part.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) throw new Error("භාවිතය: .vcard නම | දුරකථන අංකය | ආයතනය (විකල්ප)");
  const phone = parts[1].replace(/[^\d+]/g, "");
  if (!/^\+?\d{8,15}$/.test(phone)) throw new Error("වලංගු දුරකථන අංකයක් ඇතුළත් කරන්න.");
  const clean = value => String(value || "").replace(/[\r\n:;,]/g, " ").trim();
  return [
    "BEGIN:VCARD", "VERSION:3.0", "FN:" + clean(parts[0]),
    "TEL;TYPE=CELL:" + phone,
    ...(parts[2] ? ["ORG:" + clean(parts[2])] : []),
    "END:VCARD", ""
  ].join("\r\n");
}
export function parseScheduleInput(input) {
  const match = String(input || "").trim().match(/^(\d+)(m|h|d)\s+(\+?\d{8,15})\s*\|\s*([\s\S]+)$/i);
  if (!match) throw new Error("භාවිතය: .schedule 10m 9477XXXXXXX | යැවිය යුතු පණිවිඩය");
  const amount = Number(match[1]);
  const multiplier = { m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
  const delayMs = amount * multiplier;
  if (!Number.isSafeInteger(delayMs) || delayMs < 60000 || delayMs > 30 * 86400000) {
    throw new Error("කාලය විනාඩි 1 සිට දින 30 දක්වා විය යුතුයි.");
  }
  const number = match[3].replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(number)) throw new Error("Country code සමඟ නිවැරදි අංකය ඇතුළත් කරන්න.");
  const text = match[4].trim();
  if (!text || text.length > 1500) throw new Error("පණිවිඩය අකුරු 1-1500 අතර විය යුතුයි.");
  return { number, text, dueAt: Date.now() + delayMs };
}
function htmlText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/gi, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ").trim();
}
export function parseSearchResults(html, limit = 5) {
  const results = [];
  const blocks = String(html || "").split(/class="result results_links/).slice(1);
  for (const block of blocks) {
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    const title = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/);
    if (!link || !title) continue;
    let url = link[1].replace(/&amp;/g, "&");
    try {
      const parsed = new URL(url, "https://duckduckgo.com");
      const redirect = parsed.searchParams.get("uddg");
      if (redirect) url = decodeURIComponent(redirect);
    } catch {}
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({ title: htmlText(title[1]), url, snippet: htmlText(snippet?.[1] || "") });
    if (results.length >= limit) break;
  }
  return results;
}
async function webSearch(query) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; HasaBot/1.0)", accept: "text/html" },
    signal: AbortSignal.timeout(18000)
  });
  if (!response.ok) throw new Error("Web Search සේවාව තාවකාලිකව ලබාගත නොහැක.");
  const results = parseSearchResults(await response.text(), 5);
  if (!results.length) throw new Error("ප්‍රතිඵල හමු වුණේ නැහැ. වෙනත් වචන භාවිතා කර බලන්න.");
  return results;
}
async function gemini(prompt, media, mimeType, config) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY සකස් කර නැහැ.");
  const model = config.aiModel || "gemini-2.0-flash";
  const parts = [{ text: prompt }];
  if (media) parts.push({ inline_data: { mime_type: mimeType, data: media.toString("base64") } });
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }), signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error("Gemini HTTP " + response.status);
  const data = await response.json();
  const answer = data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim();
  if (!answer) throw new Error("Gemini පිළිතුරක් ලබාදුන්නේ නැහැ.");
  await recordAiUsage("gemini", true);
  return answer;
}
function jpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  throw new Error("JPEG image dimensions කියවිය නොහැක.");
}
export function createJpegPdf(jpeg) {
  const size = jpegSize(jpeg);
  const scale = Math.min(595 / size.width, 842 / size.height, 1);
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + width + " " + height + "] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.concat([Buffer.from("<< /Type /XObject /Subtype /Image /Width " + size.width + " /Height " + size.height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpeg.length + " >>\nstream\n"), jpeg, Buffer.from("\nendstream")]),
    Buffer.from("<< /Length 35 >>\nstream\nq " + width + " 0 0 " + height + " 0 0 cm /Im0 Do Q\nendstream")
  ];
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  let position = chunks[0].length;
  for (let i = 0; i < objects.length; i++) {
    offsets.push(position);
    const chunk = Buffer.concat([Buffer.from((i + 1) + " 0 obj\n"), objects[i], Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    position += chunk.length;
  }
  const xrefOffset = position;
  const xref = ["xref\n0 " + (objects.length + 1), "0000000000 65535 f "];
  for (let i = 1; i < offsets.length; i++) xref.push(String(offsets[i]).padStart(10, "0") + " 00000 n ");
  chunks.push(Buffer.from(xref.join("\n") + "\ntrailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF"));
  return Buffer.concat(chunks);
}
async function saveSchedules() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const temp = SCHEDULE_FILE + ".tmp";
  await fsp.writeFile(temp, JSON.stringify(pending, null, 2), { mode: 0o600 });
  await fsp.rename(temp, SCHEDULE_FILE);
}
async function loadSchedules() {
  if (schedulerLoaded) return;
  schedulerLoaded = true;
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    const data = JSON.parse(await fsp.readFile(SCHEDULE_FILE, "utf8"));
    pending = Array.isArray(data) ? data.filter(item =>
      item && typeof item.id === "string" && /^\d{8,15}@s\.whatsapp\.net$/.test(item.jid) &&
      typeof item.text === "string" && Number.isFinite(item.dueAt)) : [];
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Scheduled message store could not be read:", error.message);
    pending = [];
  }
}
function armSchedules(sock) {
  activeSocket = sock;
  for (const item of pending) {
    if (timers.has(item.id)) continue;
    const delay = Math.max(0, Math.min(2147483000, item.dueAt - Date.now()));
    const timer = setTimeout(async () => {
      timers.delete(item.id);
      const current = pending.find(entry => entry.id === item.id);
      if (!current || !activeSocket) return;
      try {
        await activeSocket.sendMessage(current.jid, { text: current.text });
        console.log("[SCHEDULE] Delivered scheduled message " + current.id);
      } catch (error) {
        console.error("[SCHEDULE] Delivery failed for " + current.id + ":", error.message);
      } finally {
        pending = pending.filter(entry => entry.id !== current.id);
        await saveSchedules().catch(error => console.error("Schedule save failed:", error.message));
      }
    }, delay);
    timers.set(item.id, timer);
  }
}
export async function onConnection(sock) {
  await loadSchedules();
  armSchedules(sock);
}
export default async function advancedTools({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const prefix = config.prefix || ".";
  const body = bodyOf(message).trim();
  if (!body.startsWith(prefix)) return;
  const rest = body.slice(prefix.length).trim();
  const split = rest.search(/\s/);
  const command = (split < 0 ? rest : rest.slice(0, split)).toLowerCase();
  const arg = split < 0 ? "" : rest.slice(split).trim();
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });

  if (command === "search") {
    if (!arg || arg.length > 300) return send("භාවිතය: " + prefix + "search ශ්‍රී ලංකාවේ අද ප්‍රධාන පුවත්");
    await send("🔎 Web එකේ සොයමින්...");
    try {
      const results = await webSearch(arg);
      const output = ["🌐 *WEB SEARCH RESULTS*", "", ...results.flatMap((item, index) => [
        (index + 1) + ". *" + item.title.slice(0, 180) + "*",
        item.snippet.slice(0, 260),
        item.url,
        ""
      ])];
      return send(output.join("\n").slice(0, 3800));
    } catch (error) { return send("❌ " + error.message); }
  }

  if (command === "tts") {
    if (!arg) return send("භාවිතය: " + prefix + "tts si ඔබට සුබ දවසක් වේවා");
    const match = arg.match(/^(si|en|ta|hi)\s+([\s\S]+)$/i);
    const language = match ? match[1].toLowerCase() : "si";
    const text = (match ? match[2] : arg).trim();
    if (!text || text.length > 180) return send("❌ TTS සඳහා අකුරු 180ක් දක්වා පමණයි.");
    await send("🎙️ Voice එක සකස් කරමින්...");
    try {
      const url = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=" +
        language + "&q=" + encodeURIComponent(text);
      const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("Voice සේවාව HTTP " + response.status);
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length < 1000 || audio.length > 8 * 1024 * 1024) throw new Error("Voice audio එක ලබාගත නොහැකි වුණා.");
      return sock.sendMessage(jid, { audio, mimetype: "audio/mpeg", ptt: true }, { quoted: message });
    } catch (error) { return send("❌ Voice සකස් කිරීම අසාර්ථකයි: " + error.message); }
  }

  if (command === "qr") {
    if (!arg || arg.length > 1800) return send("භාවිතය: " + prefix + "qr https://example.com");
    try {
      const url = "https://api.qrserver.com/v1/create-qr-code/?size=512x512&format=png&data=" + encodeURIComponent(arg);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("QR සේවාව තාවකාලිකව අක්‍රීයයි.");
      const image = Buffer.from(await response.arrayBuffer());
      if (image.length > 3 * 1024 * 1024) throw new Error("QR image එක විශාල වැඩියි.");
      return sock.sendMessage(jid, { image, caption: "📱 *HASA QR CODE*\n\n" + arg.slice(0, 500) }, { quoted: message });
    } catch (error) { return send("❌ " + error.message); }
  }

  if (command === "vcard") {
    try {
      const card = parseVCardInput(arg);
      return sock.sendMessage(jid, { document: Buffer.from(card, "utf8"), mimetype: "text/vcard",
        fileName: "hasa-contact.vcf", caption: "👤 Contact card එක සූදානම්." }, { quoted: message });
    } catch (error) { return send("❌ " + error.message); }
  }

  if (command === "pdf") {
    const media = mediaFrom(message, "documentMessage");
    if (!media || !/pdf/i.test(media.mimetype || "") && !/\.pdf$/i.test(media.fileName || "")) {
      return send("📄 PDF file එකකට Reply කර " + prefix + "pdf යවන්න.");
    }
    await send("📄 PDF එක කියවමින්...");
    try {
      const data = await download(media, "document", 12 * 1024 * 1024);
      let extracted = extractPdfText(data);
      if (!extracted && process.env.PDFTOTEXT_PATH !== "disabled") {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hasa-pdf-"));
        try {
          const input = path.join(dir, "input.pdf");
          const output = path.join(dir, "output.txt");
          await fsp.writeFile(input, data);
          await exec(process.env.PDFTOTEXT_PATH || "pdftotext", ["-layout", input, output], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
          extracted = await fsp.readFile(output, "utf8");
        } catch (error) {
          if (error.code !== "ENOENT") console.warn("PDF text fallback failed:", error.message);
        } finally { await fsp.rm(dir, { recursive: true, force: true }); }
      }
      if (!extracted.trim()) return send("⚠️ PDF එකෙන් text ලබාගත නොහැකි වුණා. මෙය scanned PDF එකක් නම් page එක image එකක් ලෙස එවා .ocr භාවිතා කරන්න.");
      if (process.env.GEMINI_API_KEY && config.aiChat) {
        try {
          const summary = await gemini("Summarize this PDF in the same language as the document. Include the main points and important dates/numbers. Text:\n\n" + extracted.slice(0, 18000), null, null, config);
          return send("📑 *PDF SUMMARY*\n\n" + summary.slice(0, 3500));
        } catch (error) { console.warn("PDF AI summary failed:", error.message); }
      }
      return send("📄 *PDF TEXT EXTRACT*\n\n" + extracted.slice(0, 3500) + (extracted.length > 3500 ? "\n\n… ඉතිරි කොටස file එකේ ඇත." : ""));
    } catch (error) { return send("❌ PDF කියවීම අසාර්ථකයි: " + error.message); }
  }

  if (command === "ocr") {
    const media = mediaFrom(message, "imageMessage");
    if (!media) return send("🖼️ Photo එකකට Reply කර " + prefix + "ocr යවන්න.");
    if (!process.env.GEMINI_API_KEY || !config.aiChat) return send("⛔ OCR සඳහා AI Chat ON කර GEMINI_API_KEY සකස් කළ යුතුයි.");
    await send("🔍 Image එකේ අකුරු හඳුනාගනිමින්...");
    try {
      const image = await download(media, "image", 10 * 1024 * 1024);
      const answer = await gemini("Extract all visible text from this image exactly. Preserve the original language, line breaks, numbers and spelling. If there is no readable text, say so.", image, media.mimetype || "image/jpeg", config);
      return send("📝 *OCR TEXT*\n\n" + answer.slice(0, 3800));
    } catch (error) {
      await recordAiUsage("gemini", false).catch(() => {});
      return send("❌ OCR අසාර්ථකයි: " + error.message);
    }
  }

  if (command === "topdf") {
    const media = mediaFrom(message, "imageMessage");
    if (!media) return send("🖼️ Photo එකකට Reply කර " + prefix + "topdf යවන්න.");
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hasa-topdf-"));
    try {
      const input = path.join(dir, "input.bin");
      const output = path.join(dir, "image.jpg");
      await send("📄 Photo එක PDF කරමින්...");
      const image = await download(media, "image", 12 * 1024 * 1024);
      await fsp.writeFile(input, image);
      await exec("ffmpeg", ["-y", "-i", input, "-frames:v", "1", "-q:v", "3", output], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
      const pdf = createJpegPdf(await fsp.readFile(output));
      if (pdf.length > 16 * 1024 * 1024) throw new Error("PDF file එක විශාල වැඩියි.");
      return sock.sendMessage(jid, { document: pdf, mimetype: "application/pdf", fileName: "hasa-image.pdf",
        caption: "✅ Photo එක PDF බවට පරිවර්තනය කළා." }, { quoted: message });
    } catch (error) {
      return send(/ENOENT/.test(String(error.code)) ? "❌ Server එකේ FFmpeg ස්ථාපනය කර නැහැ." : "❌ PDF convert අසාර්ථකයි: " + error.message);
    } finally { await fsp.rm(dir, { recursive: true, force: true }); }
  }

  if (command === "aiusage") {
    if (!isOwner(message, jid, config)) return send("⛔ මේ command එක Ownerට පමණයි.");
    try {
      const { getAiUsage } = await import("../lib/ai-usage.js");
      const stats = await getAiUsage();
      const line = provider => {
        const item = stats.providers?.[provider] || {};
        return provider.toUpperCase() + ": " + (item.total || 0) + " requests | " +
          (item.success || 0) + " success | " + (item.failed || 0) + " failed";
      };
      return send("📊 *AI USAGE MONITOR*\n\n" + line("gemini") + "\n" + line("groq") +
        "\n\nLast request: " + (stats.lastUsed || "Not yet") +
        "\n\n🔒 Prompts, messages and API keys are never stored in this report.");
    } catch (error) { return send("❌ AI usage data කියවිය නොහැක: " + error.message); }
  }

  if (["schedule", "schedules", "cancelschedule"].includes(command)) {
    if (!isOwner(message, jid, config)) return send("⛔ Scheduler භාවිතා කළ හැක්කේ Ownerට පමණයි.");
    await loadSchedules();
    if (command === "schedule") {
      let parsed;
      try { parsed = parseScheduleInput(arg); }
      catch (error) { return send("❌ " + error.message); }
      if (pending.length >= 20) return send("⚠️ Pending schedule 20ක සීමාව පිරී ඇත.");
      const item = { id: randomBytes(3).toString("hex"), jid: parsed.number + "@s.whatsapp.net",
        text: parsed.text, dueAt: parsed.dueAt, createdAt: Date.now() };
      pending.push(item);
      try { await saveSchedules(); }
      catch (error) { pending = pending.filter(entry => entry.id !== item.id); return send("❌ Schedule එක save කළ නොහැකි වුණා: " + error.message); }
      armSchedules(sock);
      return send("✅ *Message Scheduled*\nID: " + item.id + "\nTo: " + parsed.number +
        "\nAt: " + new Date(item.dueAt).toLocaleString("en-GB", { timeZone: "Asia/Colombo" }) + " (Sri Lanka time)");
    }
    if (command === "schedules") {
      if (!pending.length) return send("📭 Pending scheduled messages නැහැ.");
      return send("🗓️ *PENDING SCHEDULES*\n\n" + pending.map(item =>
        "ID: " + item.id + "\nTo: " + item.jid.split("@")[0] + "\nAt: " +
        new Date(item.dueAt).toLocaleString("en-GB", { timeZone: "Asia/Colombo" }) +
        "\nMessage: " + item.text.slice(0, 100) + "\n"
      ).join("\n").slice(0, 3500));
    }
    const id = arg.trim();
    const item = pending.find(entry => entry.id === id);
    if (!item) return send("❌ ඒ ID එකට ගැළපෙන pending schedule එකක් නැහැ.");
    clearTimeout(timers.get(id));
    timers.delete(id);
    pending = pending.filter(entry => entry.id !== id);
    await saveSchedules();
    return send("✅ Schedule " + id + " අවලංගු කළා.");
  }
}
