import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import makeWASocket, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

const active = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanNumber = value => String(value || "").replace(/\D/g, "");
const cacheFor = () => new Map();

export function listSubbots() {
  return [...active.entries()].map(([owner, item]) => ({
    owner, connected: item.connected, startedAt: item.startedAt,
    jid: item.sock?.user?.id || null, sessionDir: item.sessionDir
  }));
}

export async function stopSubbot(ownerJid, { removeSession = false } = {}) {
  const key = cleanNumber(ownerJid);
  const item = active.get(key);
  if (item) {
    item.stopping = true;
    clearTimeout(item.timer);
    try { item.sock?.end(new Error("Subbot stopped by owner")); } catch {}
    try { item.sock?.ws?.close(); } catch {}
    active.delete(key);
  }
  const dir = path.resolve("./subbot_sessions", key);
  if (removeSession && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  return Boolean(item || (removeSession && !fs.existsSync(dir)));
}

export async function startSubbot({ ownerJid, phoneNumber, mainSock, config, plugins }) {
  const key = cleanNumber(ownerJid);
  if (!key) throw new Error("Could not identify the owner number.");
  if (active.has(key)) throw new Error("A Subbot is already active. Use .stopsubbot first.");
  const phone = cleanNumber(phoneNumber);
  if (phone && (phone.length < 8 || phone.length > 15)) throw new Error("Phone number must include country code, digits only.");
  const sessionDir = path.resolve("./subbot_sessions", key);
  fs.mkdirSync(sessionDir, { recursive: true });
  const item = { sock: null, connected: false, startedAt: Date.now(), sessionDir, timer: null, stopping: false, phone };
  active.set(key, item);

  const connect = async () => {
    if (item.stopping || active.get(key) !== item) return;
    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      if (!state.creds.registered && !phone) throw new Error("No saved Subbot session. Start it with .subbot <phone number>.");
      const { version } = await fetchLatestBaileysVersion();
      const sock = makeWASocket({
        version, auth: state, logger: pino({ level: "silent" }),
        browser: ["Hasa_2_SubBot", "Chrome", "1.0.0"],
        printQRInTerminal: false, markOnlineOnConnect: false,
        syncFullHistory: false, connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 25_000
      });
      item.sock = sock;
      sock.ev.on("creds.update", saveCreds);
      let requested = false;
      sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (item.stopping || active.get(key) !== item) return;
        if (connection === "connecting" && !state.creds.registered && !requested) {
          requested = true;
          try {
            const deadline = Date.now() + 60_000;
            while (!item.stopping && sock.ws?.isOpen !== true && Date.now() < deadline) await sleep(500);
            if (item.stopping || sock.ws?.isOpen !== true) throw new Error("Subbot websocket did not open in time.");
            await sleep(1000);
            const code = await sock.requestPairingCode(phone);
            await mainSock.sendMessage(ownerJid, {
              text: "🔐 *Subbot pairing code*\n\n" + code.match(/.{1,4}/g).join("-") +
                "\n\nWhatsApp > Linked devices > Link a device > Link with phone number instead"
            });
          } catch (error) {
            await mainSock.sendMessage(ownerJid, { text: "Subbot pairing failed: " + error.message + ". Reconnecting with the saved session; no QR login is used." }).catch(() => {});
            try { sock.end(error); } catch {}
          }
        }
        if (connection === "open") {
          item.connected = true;
          item.startedAt = Date.now();
          await mainSock.sendMessage(ownerJid, { text: "✅ Subbot connected: " + (sock.user?.id || "online") }).catch(() => {});
        }
        if (connection === "close") {
          item.connected = false;
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut || item.stopping) {
            active.delete(key);
            await mainSock.sendMessage(ownerJid, { text: "Subbot disconnected. Session files were kept." }).catch(() => {});
          } else {
            clearTimeout(item.timer);
            item.timer = setTimeout(() => connect().catch(err => console.error("Subbot reconnect error:", err.message)), 5000);
          }
        }
      });
      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify" || item.stopping) return;
        const cache = item.cache || (item.cache = cacheFor());
        for (const msg of messages || []) {
          if (!msg?.message || msg.key?.remoteJid === "status@broadcast") continue;
          const id = msg.key?.remoteJid + ":" + msg.key?.id;
          cache.set(id, msg);
          if (cache.size > 1000) cache.delete(cache.keys().next().value);
          await plugins.handleMessage(sock, msg, config, cache);
        }
      });
    } catch (error) {
      console.error("Subbot start error:", error.stack || error.message);
      active.delete(key);
      throw error;
    }
  };

  await connect();
  return { sessionDir, pairingRequired: true };
}
