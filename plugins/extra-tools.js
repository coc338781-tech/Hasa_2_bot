import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const exec = promisify(execFile);
const EMOJIS = ["❤️", "🔥", "👍", "😂", "💯", "😍"];
function bodyOf(message) {
  return message.message?.conversation || message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption || message.message?.videoMessage?.caption || "";
}
function quotedMedia(message) {
  const current = message.message || {};
  const quoted = current.extendedTextMessage?.contextInfo?.quotedMessage || {};
  const q = quoted.viewOnceMessageV2?.message || quoted;
  return current.imageMessage ? { media: current.imageMessage, kind: "image" } :
    current.videoMessage ? { media: current.videoMessage, kind: "video" } :
    q.imageMessage ? { media: q.imageMessage, kind: "image" } :
    q.videoMessage ? { media: q.videoMessage, kind: "video" } : null;
}
function isOwner(message, jid, config) {
  if (message.key?.fromMe) return true;
  const sender = String(message.key?.participant || jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(n => String(n).replace(/\D/g, "") === sender);
}
function weatherText(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Mainly clear / partly cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown conditions";
}
async function weather(city) {
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", city);
  geoUrl.searchParams.set("count", "1");
  geoUrl.searchParams.set("language", "en");
  geoUrl.searchParams.set("format", "json");
  const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(12000) });
  if (!geoRes.ok) throw new Error("Weather location lookup failed");
  const place = (await geoRes.json()).results?.[0];
  if (!place) throw new Error("නගරය හමු වුණේ නැහැ.");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", place.latitude);
  url.searchParams.set("longitude", place.longitude);
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("timezone", "auto");
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("Weather service unavailable");
  const current = (await res.json()).current;
  return [
    "🌦️ *WEATHER: " + place.name + (place.country ? ", " + place.country : "") + "*",
    "",
    "🌡️ Temperature: *" + current.temperature_2m + "°C*",
    "🤗 Feels like: " + current.apparent_temperature + "°C",
    "☁️ Conditions: " + weatherText(current.weather_code),
    "💧 Humidity: " + current.relative_humidity_2m + "%",
    "🌧️ Precipitation: " + current.precipitation + " mm",
    "💨 Wind: " + current.wind_speed_10m + " km/h",
    "",
    "Data: Open-Meteo"
  ].join("\n");
}
function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
async function movie(query) {
  const url = "https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(query);
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("Movie database unavailable");
  const results = await res.json();
  const show = results?.[0]?.show;
  if (!show) throw new Error("මේ නමට ගැළපෙන චිත්‍රපට / TV show එකක් හමු වුණේ නැහැ.");
  return [
    "🎬 *" + show.name + "*",
    "",
    "📺 Type: " + (show.type || "N/A"),
    "🎭 Genres: " + ((show.genres || []).join(", ") || "N/A"),
    "⭐ Rating: " + (show.rating?.average ?? "N/A"),
    "📅 Premiered: " + (show.premiered || "N/A"),
    "📌 Status: " + (show.status || "N/A"),
    "",
    stripHtml(show.summary).slice(0, 900) || "No summary available.",
    "",
    show.url || ""
  ].filter(Boolean).join("\n");
}
async function makeSticker(sock, jid, message) {
  const found = quotedMedia(message);
  if (!found) throw new Error("Photo/Video එකකට Reply කර .sticker යවන්න.");
  const stream = await downloadContentFromMessage(found.media, found.kind);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > 18 * 1024 * 1024) throw new Error("Media file එක 18 MB සීමාව ඉක්මවා ඇත.");
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  if (!input.length) throw new Error("Media data ලබාගත නොහැක.");
  const dir = path.resolve("./tmp/stickers");
  await fs.mkdir(dir, { recursive: true });
  const id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const source = path.join(dir, id + (found.kind === "video" ? ".mp4" : ".jpg"));
  const output = path.join(dir, id + ".webp");
  try {
    await fs.writeFile(source, input);
    await exec("ffmpeg", ["-y", "-i", source, "-vf",
      "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
      "-vcodec", "libwebp", "-lossless", "0", "-q:v", "65", "-loop", "0",
      "-an", "-vsync", "0", "-t", "6", "-fs", "512k", output], { timeout: 45000 });
    const sticker = await fs.readFile(output);
    return sock.sendMessage(jid, { sticker }, { quoted: message });
  } finally {
    await fs.rm(source, { force: true }).catch(() => {});
    await fs.rm(output, { force: true }).catch(() => {});
  }
}
export default async function extraTools({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const body = bodyOf(message).trim();
  const prefix = config.prefix || ".";
  const lower = body.toLowerCase();
  if (lower.startsWith(prefix + "autoreact")) {
    if (!isOwner(message, jid, config)) return sock.sendMessage(jid, { text: "⛔ Owner only." }, { quoted: message });
    const mode = lower.slice((prefix + "autoreact").length).trim();
    if (!["on", "off"].includes(mode)) return sock.sendMessage(jid, { text: "භාවිතය: " + prefix + "autoreact on/off" }, { quoted: message });
    config.autoReact = mode === "on";
    await fs.writeFile("./config.json", JSON.stringify(config, null, 2));
    return sock.sendMessage(jid, { text: "✅ Auto React " + (config.autoReact ? "ON 🟢" : "OFF 🔴") }, { quoted: message });
  }
  if (message.key?.fromMe || !config.autoReact || body.startsWith(prefix)) return;
  if (message.message?.protocolMessage || message.message?.reactionMessage) return;
  try {
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    await sock.sendMessage(jid, { react: { text: emoji, key: message.key } });
  } catch (error) {
    console.error("Auto react failed:", error.message);
  }
  if (!body.startsWith(prefix)) return;
  const rest = body.slice(prefix.length).trim();
  const split = rest.search(/\s/);
  const command = (split < 0 ? rest : rest.slice(0, split)).toLowerCase();
  const arg = split < 0 ? "" : rest.slice(split).trim();
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });
  if (command === "weather") {
    if (!arg) return send("භාවිතය: " + prefix + "weather Colombo");
    try { return send(await weather(arg)); }
    catch (error) { return send("❌ " + error.message); }
  }
  if (command === "movie") {
    if (!arg) return send("භාවිතය: " + prefix + "movie Interstellar");
    try { return send(await movie(arg)); }
    catch (error) { return send("❌ " + error.message); }
  }
  if (command === "sticker") {
    try { return await makeSticker(sock, jid, message); }
    catch (error) { return send("❌ " + error.message + (error.code === "ENOENT" ? "\nServer එකේ ffmpeg අවශ්‍යයි." : "")); }
  }
}
