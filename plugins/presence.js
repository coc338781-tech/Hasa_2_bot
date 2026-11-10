import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
let onlineTimer = null;

async function applyAlwaysOnline(sock, enabled) {
  if (onlineTimer) {
    clearInterval(onlineTimer);
    onlineTimer = null;
  }
  if (!enabled) {
    await sock.sendPresenceUpdate("unavailable").catch(() => {});
    return;
  }
  await sock.sendPresenceUpdate("available").catch(() => {});
  onlineTimer = setInterval(() => {
    if (sock?.user) sock.sendPresenceUpdate("available").catch(() => {});
  }, 30_000);
  onlineTimer.unref?.();
}

export async function onConnection(sock, config) {
  await applyAlwaysOnline(sock, config?.alwaysOnline === true);
}

export async function onConfigUpdate(sock, config) {
  await applyAlwaysOnline(sock, config?.alwaysOnline === true);
}

export default async function presence({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || message.key.fromMe) return;
  if (config.composing) {
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    setTimeout(() => sock.sendPresenceUpdate("paused", jid).catch(() => {}), 1800);
  }
  if (!config.autoVoice || !message.message?.audioMessage || message.message.audioMessage.ptt === false) return;
  const dir = path.resolve("./tmp/voice");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  const mp3 = path.join(dir, stamp + ".mp3");
  const ogg = path.join(dir, stamp + ".ogg");
  try {
    const text = config.autoVoiceText || "Hello, I received your voice message.";
    const url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(text) + "&tl=en&client=tw-ob";
    const response = await axios.get(url, { responseType: "arraybuffer", timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } });
    fs.writeFileSync(mp3, Buffer.from(response.data));
    await exec("ffmpeg", ["-y", "-i", mp3, "-c:a", "libopus", "-b:a", "48k", "-ar", "48000", "-ac", "1", ogg], { timeout: 25000 });
    await sock.sendMessage(jid, { audio: fs.readFileSync(ogg), mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: message });
  } catch (error) {
    console.error("Auto voice failed (check internet/ffmpeg):", error.message);
  } finally {
    for (const f of [mp3, ogg]) try { fs.unlinkSync(f); } catch {}
  }
}
