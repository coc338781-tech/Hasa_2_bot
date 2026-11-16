import { mkdir, chmod } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^\+[1-9]\d{7,14}$/;
function safeInstancePath(root, id) {
  if (!INSTANCE_ID.test(id || "")) throw new TypeError("invalid_instance_id");
  const base = resolve(root), target = resolve(base, id);
  if (!target.startsWith(base + sep)) throw new TypeError("invalid_instance_path");
  return target;
}
export function createWhatsAppWorker({ dataDir, baileys, logger, onPairingCode = async () => {}, onStatus = async () => {}, maxSessions = 3, pairingTimeoutMs = 120_000 } = {}) {
  if (!dataDir || !baileys?.default || !baileys?.useMultiFileAuthState) throw new TypeError("worker_requires_data_dir_and_baileys_adapter");
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 100) throw new TypeError("invalid_max_sessions");
  const sessions = new Map(), log = logger || { info() {}, warn() {}, error() {} };
  async function notify(instanceId, status, extra = {}) { await onStatus({ instanceId, status, ...extra }); }
  async function startPairing({ instanceId, phone }) {
    if (!PHONE.test(phone || "")) throw new TypeError("invalid_phone");
    if (sessions.has(instanceId)) {
      const existing = sessions.get(instanceId);
      if (existing.status === "pairing" || existing.status === "online") return { instanceId, status: existing.status };
      await stop(instanceId);
    }
    if (sessions.size >= maxSessions) { const error = new Error("worker_capacity_reached"); error.code = "worker_capacity_reached"; throw error; }
    const authDir = safeInstancePath(dataDir, instanceId);
    await mkdir(authDir, { recursive: true, mode: 0o700 }); await chmod(authDir, 0o700);
    const auth = await baileys.useMultiFileAuthState(authDir);
    const socket = baileys.default({ auth: auth.state, logger: log, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false, connectTimeoutMs: 60_000, defaultQueryTimeoutMs: 60_000, keepAliveIntervalMs: 25_000, browser: ["HASA BOT NETWORK", "Chrome", "1.0"] });
    const entry = { socket, status: "pairing", pairingCodeIssued: false, timer: null, generation: randomUUID() };
    sessions.set(instanceId, entry); await notify(instanceId, "pairing");
    entry.timer = setTimeout(() => {
      if (sessions.get(instanceId) !== entry || entry.status !== "pairing") return;
      entry.status = "expired"; void notify(instanceId, "expired"); void socket.end?.(new Error("pairing_timeout"));
    }, pairingTimeoutMs);
    entry.timer.unref?.();
    socket.ev.on("creds.update", auth.saveCreds);
    socket.ev.on("connection.update", async update => {
      if (sessions.get(instanceId) !== entry) return;
      if (update.qr && !auth.state.creds.registered && !entry.pairingCodeIssued) {
        entry.pairingCodeIssued = true;
        try {
          const code = await socket.requestPairingCode(phone.replace(/\D/g, ""));
          if (sessions.get(instanceId) !== entry || entry.status !== "pairing") return;
          await onPairingCode({ instanceId, code, expiresAt: new Date(Date.now() + pairingTimeoutMs).toISOString() });
          await notify(instanceId, "code_ready");
        } catch (error) {
          entry.status = "failed"; clearTimeout(entry.timer);
          await notify(instanceId, "failed", { failureCode: "pairing_code_failed" });
          log.warn({ instanceId, error: error?.message }, "WhatsApp pairing code request failed");
        }
      }
      if (update.connection === "open") { clearTimeout(entry.timer); entry.status = "online"; await notify(instanceId, "paired"); }
      else if (update.connection === "close" && entry.status !== "expired") {
        clearTimeout(entry.timer); entry.status = "offline"; await notify(instanceId, "offline"); sessions.delete(instanceId);
      }
    });
    return { instanceId, status: "pairing" };
  }
  async function stop(instanceId) {
    const entry = sessions.get(instanceId); if (!entry) return false;
    sessions.delete(instanceId); clearTimeout(entry.timer); entry.status = "stopped";
    try { entry.socket.end?.(new Error("instance_stopped")); } catch {}
    await notify(instanceId, "stopped"); return true;
  }
  async function stopAll() { await Promise.all([...sessions.keys()].map(stop)); }
  function getStatus(instanceId) { const entry = sessions.get(instanceId); return entry ? { instanceId, status: entry.status } : { instanceId, status: "offline" }; }
  return Object.freeze({ startPairing, stop, stopAll, getStatus, get activeCount() { return sessions.size; } });
}
