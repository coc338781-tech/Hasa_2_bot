import "dotenv/config";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
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
  if (state.creds.registered || pairingRequestedFor === generation) return;
  pairingRequestedFor = generation;

  try {
    // Do not ask for the phone number until WhatsApp's websocket is actually open.
    // This avoids accepting input while the initial connection is still failing.
    const deadline = Date.now() + 45_000;
    while (
      generation === socketGeneration &&
      !state.creds.registered &&
      sock.ws?.isOpen !== true &&
      Date.now() < deadline
    ) {
      await sleep(250);
    }

    if (generation !== socketGeneration || state.creds.registered) return;
    if (sock.ws?.isOpen !== true) {
      throw new Error("WhatsApp connection did not become ready. No pairing code was requested. Check the connection error above.");
    }

    const phone = await askPhone();
    if (phone.length < 8 || phone.length > 15) {
      phoneNumber = "";
      throw new Error("Invalid phone number. Include country code, digits only.");
    }

    // Re-check the socket after the user enters the number.
    if (generation !== socketGeneration || sock.ws?.isOpen !== true) {
      throw new Error("WhatsApp disconnected before the pairing code could be requested. Please restart the bot.");
    }

    await sleep(1500);
    const code = await sock.requestPairingCode(phone);
    console.log("\n================================");
    console.log(" WHATSAPP PAIRING CODE: " + code.match(/.{1,4}/g).join("-"));
    console.log("================================\n");
    console.log("WhatsApp > Linked devices > Link a device > Link with phone number instead");
  } catch (error) {
    console.error("Pairing code error:", error.message);
    console.error("The saved auth_info folder was not deleted.");
  }
}

async function startBot() {
  const generation = ++socketGeneration;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ["Hasa_2_bot", "Chrome", "1.0.0"],
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: 60_000,
    keepAliveIntervalMs: 25_000
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (generation !== socketGeneration) return;
    if (connection === "connecting" && !state.creds.registered) {
      void requestPairingCode(sock, state, generation);
    }
    if (connection === "open") {
      reconnectAttempts = 0;
      console.log("✅ Hasa_2_bot connected. Pairing-code login only.");
    }
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log("WhatsApp connection closed:", code ?? "unknown");
      if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
        console.error("Session is logged out or invalid. auth_info was NOT deleted.");
      } else if (!shuttingDown) {
        const delay = Math.min(60_000, 3000 * (2 ** Math.min(reconnectAttempts++, 4)));
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => startBot().catch(err => console.error("Reconnect failed:", err)), delay);
        console.log("Reconnecting in " + Math.round(delay / 1000) + " seconds...");
      }
    }
  });

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
