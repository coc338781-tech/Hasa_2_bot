import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  Browsers,
  downloadContentFromMessage
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import fs from "node:fs";
import readline from "node:readline";
import { loadPlugins } from "./lib/plugin-loader.js";

const logger = pino({ level: process.env.LOG_LEVEL || "silent" });
const authDir = "./auth_info";
const messageCache = new Map();
let config;
let plugins;
let socketGeneration = 0;
let reconnectTimer;
let reconnectAttempts = 0;
let shuttingDown = false;
let pairingRequestedFor = -1;
let pairingIssued = false;
let phoneNumber = process.env.BOT_PHONE_NUMBER || "";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function askPhone() {
  if (phoneNumber) return phoneNumber.replace(/\D/g, "");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  phoneNumber = await new Promise(resolve => rl.question(
    "WhatsApp number with country code (digits only): ", answer => {
      rl.close();
      resolve(answer.trim());
    }
  ));
  phoneNumber = phoneNumber.replace(/\D/g, "");
  return phoneNumber;
}

function remember(message) {
  const key = message?.key;
  if (!key?.remoteJid || !key?.id || !message.message) return;
  messageCache.set(key.remoteJid + ":" + key.id, message);
  if (messageCache.size > 2000) {
    messageCache.delete(messageCache.keys().next().value);
  }
}

async function requestPairingCode(sock, state, generation) {
  if (state.creds.registered || pairingIssued || pairingRequestedFor === generation) return;
  pairingRequestedFor = generation;

  try {
    // Match the working NOX setup: allow the new socket to initialize first.
    await sleep(1500);
    if (generation !== socketGeneration || state.creds.registered) return;

    const code = await sock.requestPairingCode(phoneNumber);
    pairingIssued = true;
    console.log("\nPAIRING CODE: " + code.match(/.{1,4}/g).join("-"));
    console.log("WhatsApp > Linked devices > Link a device > Link with phone number instead");
  } catch (error) {
    console.error("Pairing code error:", error.message);
    console.error("The saved auth_info folder was not deleted.");
  }
}

async function startBot() {
  const generation = ++socketGeneration;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: ["Mac OS", "Safari", "10.15.7"],
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, qr, lastDisconnect }) => {
    if (generation !== socketGeneration) return;
    if (qr && !state.creds.registered) {
      void requestPairingCode(sock, state, generation);
    }
    if (connection === "open") {
      reconnectAttempts = 0;
      console.log("✅ Hasa_2_bot connected. Pairing-code login only.");
    }
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log("WhatsApp connection closed:", code ?? "unknown");
      const disconnectError = lastDisconnect?.error;
      console.error("Disconnect details:", JSON.stringify({
        message: disconnectError?.message,
        statusCode: disconnectError?.output?.statusCode,
        payload: disconnectError?.output?.payload,
        data: disconnectError?.data
      }, null, 2));
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
        console.error("Session is logged out or invalid. auth_info was NOT deleted.");
      } else if (!shuttingDown) {
        const delay = Math.min(60_000, (pairingIssued ? 10_000 : 3_000) * (2 ** Math.min(reconnectAttempts++, 4)));
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => startBot().catch(err => console.error("Reconnect failed:", err)), delay);
        console.log("Reconnecting in " + Math.round(delay / 1000) + " seconds...");
      }
    }
  });

  if (!state.creds.registered) {
    void requestPairingCode(sock, state, generation);
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages || []) {
      if (!msg?.key?.remoteJid || !msg.message) continue;
      remember(msg);
      const jid = msg.key.remoteJid;
      if (jid === "status@broadcast") {
        if (config.autoStatusSeen) await sock.readMessages([msg.key]).catch(() => {});
        continue;
      }

      const viewOnceContent = msg.message.viewOnceMessageV2?.message ||
        msg.message.viewOnceMessage?.message ||
        msg.message.viewOnceMessageV2Extension?.message;
      if (config.viewOnce && viewOnceContent) {
        const typeName = Object.keys(viewOnceContent)[0];
        const media = viewOnceContent[typeName];
        if (["imageMessage", "videoMessage"].includes(typeName)) {
          try {
            const stream = await downloadContentFromMessage(media, typeName === "imageMessage" ? "image" : "video");
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            await sock.sendMessage(jid, typeName === "imageMessage"
              ? { image: buffer, caption: "👁️ View-once media" }
              : { video: buffer, caption: "👁️ View-once media" }, { quoted: msg });
          } catch (error) {
            console.error("View-once plugin error:", error.message);
          }
        }
      }
      await plugins.handleMessage(sock, msg, config, messageCache);
    }
  });
}

async function main() {
  if (!fs.existsSync("./config.json")) {
    console.error("config.json missing. Run: cp config.example.json config.json");
    process.exit(1);
  }
  try {
    config = JSON.parse(fs.readFileSync("./config.json", "utf8"));
  } catch (error) {
    console.error("config.json is invalid JSON:", error.message);
    process.exit(1);
  }
  config.prefix ||= ".";
  config.owner ||= [];
  fs.mkdirSync(authDir, { recursive: true });
  fs.mkdirSync(config.downloadDir || "downloads", { recursive: true });
  plugins = await loadPlugins();
  globalThis.__hasaPlugins = plugins;
  console.log("Loaded " + plugins.count + " active plugins:", plugins.names.join(", "));
  phoneNumber = await askPhone();
  if (!/^[1-9]\d{7,14}$/.test(phoneNumber)) {
    throw new Error("Invalid number. Country code එකත් එක්ක, 0 නැතුව. උදා: 9477XXXXXXX");
  }
  await startBot();
}

function shutdown() {
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  console.log("\nStopping Hasa_2_bot...");
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
main().catch(error => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
