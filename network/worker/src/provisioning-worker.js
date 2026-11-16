import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import { readFile } from "node:fs/promises";
import { createWhatsAppWorker } from "./whatsapp-worker.js";
import { createBotRuntime } from "./bot-runtime.js";

async function getAvailableMemoryBytes() {
  if (process.platform === "linux") {
    try {
      const meminfo = await readFile("/proc/meminfo", "utf8");
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
      if (match) {
        const bytes = Number(match[1]) * 1024;
        if (Number.isSafeInteger(bytes) && bytes >= 0) return bytes;
      }
    } catch {}
  }
  return os.freemem();
}

export function createProvisioningWorker({ client, dataDir, codeDir = "/opt/hasa-bot", baileys, logger, maxSessions = 2, minFreeMemoryBytes = 768 * 1024 * 1024, pollIntervalMs = 1500 } = {}) {
  if (!client || !dataDir || !codeDir) throw new TypeError("worker_requires_agent_client_and_data_dir");
  if (!Number.isSafeInteger(minFreeMemoryBytes) || minFreeMemoryBytes < 0) throw new TypeError("invalid_min_free_memory_bytes");
  const activePairs = new Map();
  const botRuntime = createBotRuntime({
    dataDir, codeDir, baileys, logger,
    onExit: async ({ instanceId, code, signal, error }) => {
      try {
        await client.reportInstanceStatus({
          instanceId,
          status: error || (code !== 0 && signal !== "SIGTERM") ? "failed" : "offline",
          errorCode: error || (code !== 0 && signal !== "SIGTERM" ? "bot_process_exited" : null)
        });
      } catch (reportError) {
        logger?.warn?.({ instanceId, error: reportError?.message }, "Could not report bot process exit");
      }
    }
  });
  const whatsapp = createWhatsAppWorker({
    dataDir, baileys, logger, maxSessions,
    onPairingCode: async ({ instanceId, code, expiresAt }) => {
      const current = activePairs.get(instanceId);
      if (!current) return;
      await client.submitPairingCode({ jobId: current.jobId, code, expiresAt });
    },
    onStatus: async ({ instanceId, status, failureCode }) => {
      const current = activePairs.get(instanceId);
      if (!current) return;
      if (["paired", "expired", "failed", "offline", "stopped"].includes(status)) {
        try {
          await client.updatePairingStatus({
            jobId: current.jobId,
            status: status === "stopped" ? "offline" : status,
            failureCode: failureCode || (status === "offline" || status === "stopped" ? "whatsapp_disconnected" : null)
          });
          activePairs.delete(instanceId);
        } catch (error) {
          if (status !== "paired") activePairs.delete(instanceId);
          throw error;
        }
      }
    }
  });
  let running = false, stopped = false, loopPromise = null;
  let activeMinFreeMemoryBytes = minFreeMemoryBytes;
  let restoreQueue = [];
  async function refreshMemoryPolicy() {
    try {
      const settings = await client.getSettings();
      if (Number.isSafeInteger(settings.minFreeMemoryBytes) && settings.minFreeMemoryBytes >= 512 * 1024 * 1024) {
        activeMinFreeMemoryBytes = settings.minFreeMemoryBytes;
      }
    } catch (error) { logger?.warn?.({ error: error?.message }, "Using last known RAM admission policy"); }
  }
  async function restoreAvailableInstances() {
    while (restoreQueue.length && botRuntime.activeCount < maxSessions && await getAvailableMemoryBytes() >= activeMinFreeMemoryBytes) {
      const item = restoreQueue.shift();
      const result = await botRuntime.restoreInstances([item.id]);
      const restored = result[0];
      if (restored?.error) {
        await client.reportInstanceStatus({ instanceId: item.id, status: "failed", errorCode: "bot_restore_failed" }).catch(() => {});
        logger?.warn?.({ instanceId: item.id, error: restored.error }, "Bot instance restore failed");
      }
    }
  }
  async function runOne() {
    await refreshMemoryPolicy();
    const memoryAvailable = await getAvailableMemoryBytes() >= activeMinFreeMemoryBytes;
    const capacityAvailable = botRuntime.activeCount + whatsapp.activeCount < maxSessions;
    const job = await client.claimNextJob({ capacityAvailable, memoryAvailable, activeInstanceIds: botRuntime.activeInstanceIds });
    if (!job) return false;
    try {
      if (job.job_type === "instance_create") {
        await botRuntime.createInstance(job);
      } else if (job.job_type === "pairing_start") {
        const pairingId = job.payload?.pairing_request_id;
        const phone = job.phone_e164;
        if (!pairingId || !phone || !job.bot_instance_id) throw Object.assign(new Error("invalid_pairing_job"), { code: "invalid_pairing_job" });
        const registeredPhone = await botRuntime.getRegisteredPhone(job.bot_instance_id);
        const requestedPhone = phone.replace(/\D/g, "");
        if (registeredPhone && registeredPhone !== requestedPhone) {
          const error = new Error("whatsapp_session_phone_mismatch"); error.code = "whatsapp_session_phone_mismatch"; throw error;
        }
        await botRuntime.setOwnerPhone(job.bot_instance_id, phone);
        activePairs.set(job.bot_instance_id, { pairingId, jobId: job.id });
        await whatsapp.startPairing({ instanceId: job.bot_instance_id, phone });
      } else if (job.job_type === "instance_start") {
        await botRuntime.startInstance(job.bot_instance_id);
      } else if (job.job_type === "instance_stop") {
        await botRuntime.stopInstance(job.bot_instance_id);
      } else if (job.job_type === "instance_restart") {
        await botRuntime.restartInstance(job.bot_instance_id);
      } else {
        throw Object.assign(new Error("unsupported_job_type"), { code: "unsupported_job_type" });
      }
      await client.finishJob(job.id, { status: "succeeded", result: { accepted: true } });
    } catch (error) {
      if (job.bot_instance_id) activePairs.delete(job.bot_instance_id);
      await client.finishJob(job.id, { status: "failed", errorCode: error.code || "worker_start_failed" });
      logger?.warn?.({ jobId: job.id, jobType: job.job_type, error: error?.message }, "Provisioning job failed");
    }
    return true;
  }
  async function loop() {
    while (!stopped) {
      try {
        const worked = await runOne();
        await restoreAvailableInstances();
        const updates = await botRuntime.collectHealthUpdates();
        for (const update of updates) {
          await client.reportInstanceStatus(update).catch(error => logger?.warn?.({ instanceId: update.instanceId, error: error?.message }, "Bot health update failed"));
        }
        if (!worked) await delay(pollIntervalMs);
      } catch (error) {
        logger?.error?.({ error: error?.message }, "Provisioning worker poll failed");
        await delay(Math.max(pollIntervalMs, 5000));
      }
    }
  }
  return Object.freeze({
    async start() {
      if (running) return;
      running = true; stopped = false;
      try {
        await refreshMemoryPolicy();
        const instances = await client.listInstances();
        restoreQueue = instances.slice(0, maxSessions);
        if (instances.length > maxSessions) {
          logger?.warn?.({ registeredInstances: instances.length, workerMaxSessions: maxSessions }, "Some instances exceed this worker's configured session capacity");
        }
        await restoreAvailableInstances();
      } catch (error) {
        logger?.warn?.({ error: error?.message }, "Could not restore online bot instances");
      }
      loopPromise = loop();
    },
    async stop() {
      stopped = true;
      await whatsapp.stopAll();
      await botRuntime.stopAll();
      if (loopPromise) await loopPromise;
      running = false;
    },
    get activeCount() { return whatsapp.activeCount + botRuntime.activeCount; }
  });
}
