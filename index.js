import "dotenv/config";
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadContentFromMessage } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";
import { loadPlugins } from "./lib/plugin-loader.js";

const config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
const logger = pino({ level: "silent" });
const authDir = "./auth_info";
const messageCache = new Map();
const seenDeletes = new Set();
let socketGeneration = 0;
let reconnectTimer;
let reconnectAttempts = 0;
let shuttingDown = false;
let pairingRequestedFor = -1;
let plugins = [];

const askPhone = () => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Enter WhatsApp number with country code (digits only): ", (answer) => {
    rl.close();
    resolve(answer.replace(/\\D/g, ""));
  });
});

const remember = (message) => {
  const key = message?.key;
  if (!key?.remoteJid || !key?.id || !message.message) return;
  const id = key.remoteJid + ":" + key.id;
  messageCache.set(id, message);
  if (messageCache.size > 1500) messageCache.delete(messageCache.keys().next().value);
};

async function startBot() {
  const generation = ++socketGeneration;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, auth: state, logger,
    browser: ["Hasa_2_bot", "Chrome", "1.0.0"],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (generation !== socketGeneration) return;
    if (connection === "connecting" && !state.creds.registered && pairingRequestedFor !== generation) {
      pairingRequestedFor = generation;
      (async () => {
        try {
          const phone = await askPhone();
          if (!phone || phone.length < 8) {
            console.log("Invalid phone number. Restart the bot and try again.");
            return;
          }
          // Wait for the WebSocket to become ready before requesting a code.
          const deadline = Date.now() + 30_000;
          while (generation === socketGeneration && !state.creds.registered &&
                 sock.ws?.isOpen !== true && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          if (generation !== socketGeneration || state.creds.registered) return;
          if (sock.ws?.isOpen !== true) {
            throw new Error("WhatsApp socket did not become ready within 30 seconds");
          }
          const code = await sock.requestPairingCode(phone);
          console.log("\\n================================");
          console.log(" WHATSAPP PAIRING CODE: " + code.match(/.{1,4}/g).join("-"));
          console.log("================================\\n");
          console.log("WhatsApp > Linked devices > Link a device > Link with phone number instead");
        } catch (error) {
          console.error("Pairing code request failed:", error.message);
          console.error("The bot will retry on the next connection. Do not delete auth_info unless the session is confirmed invalid.");
        }
      })();
    }
    if (connection === "open") {
      reconnectAttempts = 0;
      console.log("✅ Hasa_2_bot connected successfully.");
    }
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log("WhatsApp connection closed:", code ?? "unknown");
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
        console.log("Session logged out/bad. Keep auth_info for diagnosis; do not delete it automatically.");
      } else if (!shuttingDown) {
        const delay = Math.min(60_000, 3000 * (2 ** Math.min(reconnectAttempts++, 4)));
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => startBot().catch(console.error), delay);
        console.log("Reconnecting in " + Math.round(delay / 1000) + " seconds...");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      remember(msg);
      const jid = msg.key?.remoteJid;
      if (!jid || !msg.message) continue;
      if (jid === "status@broadcast") {
        if (config.autoStatusSeen) await sock.readMessages([msg.key]).catch(() => {});
        continue;
      }
      await plugins.handleMessage(sock, msg, config, messageCache).catch(err => console.error("Plugin error:", err.message));
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    if (!config.antiDelete) return;
    for (const item of updates) {
      if (item.update?.messageStubType !== 1) continue;
      const key = item.key;
      const cached = messageCache.get(key.remoteJid + ":" + key.id);
      if (!cached || seenDeletes.has(key.id)) continue;
      seenDeletes.add(key.id);
      const sender = key.participant || key.remoteJid;
      const body = cached.message?.conversation || cached.message?.extendedTextMessage?.text || "[media message]";
      await sock.sendMessage(key.remoteJid, { text: "🗑️ *Deleted message detected*\\nFrom: @" + sender.split("@")[0] + "\\n" + body, mentions: [sender] }).catch(() => {});
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    if (!config.viewOnce) return;
    for (const msg of messages) {
      const content = msg.message?.viewOnceMessageV2?.message || msg.message?.viewOnceMessage?.message || msg.message?.viewOnceMessageV2Extension?.message;
      if (!content) continue;
      const type = Object.keys(content)[0];
      const media = content[type];
      if (!["imageMessage", "videoMessage"].includes(type)) continue;
      try {
        const stream = await downloadContentFromMessage(media, type === "imageMessage" ? "image" : "video");
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        await sock.sendMessage(msg.key.remoteJid, type === "imageMessage"
          ? { image: buffer, caption: "👁️ View-once media" }
          : { video: buffer, caption: "👁️ View-once media" });
      } catch (error) { console.error("View-once handling:", error.message); }
    }
  });
}

async function main() {
  if (!fs.existsSync("./config.json")) {
    console.error("config.json missing. Copy config.example.json to config.json first.");
    process.exit(1);
  }
  fs.mkdirSync(authDir, { recursive: true });
  fs.mkdirSync(config.downloadDir || "downloads", { recursive: true });
  plugins = await loadPlugins();
  console.log("Loaded " + plugins.count + " plugin modules.");
  await startBot();
}

process.once("SIGINT", () => { shuttingDown = true; clearTimeout(reconnectTimer); console.log("\\nStopping Hasa_2_bot..."); process.exit(0); });
process.once("SIGTERM", () => { shuttingDown = true; clearTimeout(reconnectTimer); process.exit(0); });
main().catch(error => { console.error(error); process.exit(1); });
