import { mkdir, chmod, lstat } from "node:fs/promises";
import { resolve, sep, join } from "node:path";
import { randomUUID } from "node:crypto";
import pino from "pino";
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
  const sessions = new Map(), log = logger || pino({ level: "silent" });
  async function notify(instanceId, status, extra = {}) {
    try { await onStatus({ instanceId, status, ...extra }); return true; }
    catch (error) { log.warn({ instanceId, status, error: error?.message }, "Worker status callback failed"); return false; }
  }
  async function startPairing({ instanceId, phone, publicBotId = null }) {
    if (!PHONE.test(phone || "")) throw new TypeError("invalid_phone");
    if (sessions.has(instanceId)) {
      const existing = sessions.get(instanceId);
      if (existing.status === "pairing" || existing.status === "online") return { instanceId, status: existing.status };
      await stop(instanceId);
    }
    if (sessions.size >= maxSessions) { const error = new Error("worker_capacity_reached"); error.code = "worker_capacity_reached"; throw error; }
    const instanceDir = safeInstancePath(dataDir, instanceId);
    const authDir = join(instanceDir, "auth_info");
    const rootDir = resolve(dataDir);
    await mkdir(rootDir, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(rootDir);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("unsafe_worker_data_directory");
    await mkdir(instanceDir, { recursive: true, mode: 0o700 });
    const instanceInfo = await lstat(instanceDir);
    if (instanceInfo.isSymbolicLink() || !instanceInfo.isDirectory()) throw new Error("unsafe_instance_directory");
    await mkdir(authDir, { recursive: true, mode: 0o700 });
    const authInfo = await lstat(authDir);
    if (authInfo.isSymbolicLink() || !authInfo.isDirectory()) throw new Error("unsafe_instance_auth_directory");
    await chmod(authDir, 0o700);
    const auth = await baileys.useMultiFileAuthState(authDir);
    if (auth.state.creds.registered) {
      const linkedId = auth.state.creds.me?.id || auth.state.creds.me?.jid || "";
      const linkedPhone = String(linkedId).split(":")[0].replace(/\D/g, "");
      if (!linkedPhone || linkedPhone !== phone.replace(/\D/g, "")) {
        const error = new Error("whatsapp_session_phone_mismatch"); error.code = "whatsapp_session_phone_mismatch"; throw error;
      }
      const acknowledged = await notify(instanceId, "paired");
      if (!acknowledged) { const error = new Error("pairing_completion_failed"); error.code = "pairing_completion_failed"; throw error; }
      return { instanceId, status: "paired", alreadyRegistered: true };
    }
    const socket = baileys.default({ auth: auth.state, logger: log, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false, connectTimeoutMs: 60_000, defaultQueryTimeoutMs: 60_000, keepAliveIntervalMs: 25_000, browser: ["HASA BOT NETWORK", "Chrome", "1.0"] });
    const entry = { socket, status: "pairing", pairingCodeIssued: false, timer: null, generation: randomUUID() };
    sessions.set(instanceId, entry); await notify(instanceId, "pairing");
    entry.timer = setTimeout(() => {
      if (sessions.get(instanceId) !== entry || !["pairing", "code_ready"].includes(entry.status)) return;
      entry.status = "expired";
      void notify(instanceId, "expired");
      try { void Promise.resolve(socket.end?.(new Error("pairing_timeout"))).catch(error => log.warn({ instanceId, error: error?.message }, "Socket close failed")); }
      catch (error) { log.warn({ instanceId, error: error?.message }, "Socket close failed"); }
    }, pairingTimeoutMs);
    entry.timer.unref?.();
    let credentialSaveError = null;
    let credentialSaveChain = Promise.resolve();
    const persistCredentials = () => {
      credentialSaveChain = credentialSaveChain.then(async () => {
        await auth.saveCreds();
        credentialSaveError = null;
      }).catch(error => {
        credentialSaveError = error;
        log.warn({ instanceId, error: error?.message }, "WhatsApp credentials could not be saved");
      });
      return credentialSaveChain;
    };
    socket.ev.on("creds.update", () => { void persistCredentials(); });
    socket.ev.on("connection.update", async update => {
      if (sessions.get(instanceId) !== entry) return;
      if (update.qr && !auth.state.creds.registered && !entry.pairingCodeIssued) {
        entry.pairingCodeIssued = true;
        try {
          const code = await socket.requestPairingCode(phone.replace(/\D/g, ""));
          if (sessions.get(instanceId) !== entry || entry.status !== "pairing") return;
          await onPairingCode({ instanceId, code, expiresAt: new Date(Date.now() + pairingTimeoutMs).toISOString() });
          if (sessions.get(instanceId) !== entry || entry.status !== "pairing") return;
          entry.status = "code_ready";
          await notify(instanceId, "code_ready");
        } catch (error) {
          entry.status = "failed"; clearTimeout(entry.timer);
          await notify(instanceId, "failed", { failureCode: "pairing_code_failed" });
          log.warn({ instanceId, error: error?.message }, "WhatsApp pairing code request failed");
        }
      }
      if (update.connection === "open" && entry.status !== "expired" && !entry.pairingCompleteInFlight) {
        clearTimeout(entry.timer);
        entry.pairingCompleteInFlight = true;
        const finalize = async () => {
          if (sessions.get(instanceId) !== entry) return;
          await persistCredentials();
          const linkedId = auth.state.creds.me?.id || auth.state.creds.me?.jid || "";
          const linkedPhone = String(linkedId).split(":")[0].replace(/\D/g, "");
          const expectedPhone = phone.replace(/\D/g, "");
          if (credentialSaveError || auth.state.creds.registered !== true || !linkedPhone || linkedPhone !== expectedPhone) {
            entry.status = "failed";
            sessions.delete(instanceId);
            const failureCode = credentialSaveError ? "whatsapp_credentials_save_failed"
              : auth.state.creds.registered !== true ? "whatsapp_registration_not_confirmed"
              : "whatsapp_linked_phone_mismatch";
            await notify(instanceId, "failed", { failureCode });
            try { void Promise.resolve(socket.end?.(new Error(failureCode))).catch(error => log.warn({ instanceId, error: error?.message }, "Unconfirmed pairing socket close failed")); }
            catch (error) { log.warn({ instanceId, error: error?.message }, "Unconfirmed pairing socket close failed"); }
            return;
          }
          entry.status = "online";
          if (publicBotId && typeof socket.sendMessage === "function") {
            const jid = expectedPhone + "@s.whatsapp.net";
            const text = [
              "🎉 WHATSAPP LINKED!", "",
              "Your HASA WhatsApp Bot has been successfully linked.",
              "Bot ID: " + publicBotId,
              "Status: 🔴 OFFLINE",
              "Network: HASA BOT NETWORK", "",
              "Your bot will remain OFF until the network owner activates it.", "",
              "⚡ POWERED BY HASA BOT NETWORK"
            ].join(String.fromCharCode(10));
            try { await socket.sendMessage(jid, { text }); }
            catch (error) { log.warn({ instanceId, error: error?.message }, "Bot ID notification could not be sent"); }
          }
          const acknowledged = await notify(instanceId, "paired");
          if (acknowledged) {
            sessions.delete(instanceId);
            try { void Promise.resolve(socket.end?.()).catch(error => log.warn({ instanceId, error: error?.message }, "Pairing socket close failed")); }
            catch (error) { log.warn({ instanceId, error: error?.message }, "Pairing socket close failed"); }
          } else {
            entry.completionRetryTimer = setTimeout(() => void finalize(), 5000);
            entry.completionRetryTimer.unref?.();
          }
        };
        await finalize();
      }
      else if (update.connection === "close") {
        clearTimeout(entry.timer);
        clearTimeout(entry.completionRetryTimer);
        if (entry.status !== "expired") { entry.status = "offline"; await notify(instanceId, "offline"); }
        sessions.delete(instanceId);
      }
    });
    return { instanceId, status: "pairing" };
  }
  async function stop(instanceId) {
    const entry = sessions.get(instanceId); if (!entry) return false;
    sessions.delete(instanceId); clearTimeout(entry.timer); clearTimeout(entry.completionRetryTimer); entry.status = "stopped";
    try { void Promise.resolve(entry.socket.end?.(new Error("instance_stopped"))).catch(error => log.warn({ instanceId, error: error?.message }, "Socket stop failed")); }
    catch (error) { log.warn({ instanceId, error: error?.message }, "Socket stop failed"); }
    await notify(instanceId, "stopped"); return true;
  }
  async function stopAll() { await Promise.all([...sessions.keys()].map(stop)); }
  function getStatus(instanceId) { const entry = sessions.get(instanceId); return entry ? { instanceId, status: entry.status } : { instanceId, status: "offline" }; }
  return Object.freeze({ startPairing, stop, stopAll, getStatus, get activeCount() { return sessions.size; } });
}
