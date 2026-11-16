import { setTimeout as delay } from "node:timers/promises";
import { createWhatsAppWorker } from "./whatsapp-worker.js";
import { createBotRuntime } from "./bot-runtime.js";

export function createProvisioningWorker({ client, dataDir, codeDir = "/opt/hasa-bot", baileys, logger, maxSessions = 2, pollIntervalMs = 1500 } = {}) {
  if (!client || !dataDir || !codeDir) throw new TypeError("worker_requires_agent_client_and_data_dir");
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
        await client.updatePairingStatus({
          jobId: current.jobId,
          status: status === "stopped" ? "offline" : status,
          failureCode: failureCode || (status === "offline" || status === "stopped" ? "whatsapp_disconnected" : null)
        });
        activePairs.delete(instanceId);
      }
    }
  });
  let running = false, stopped = false, loopPromise = null;
  async function runOne() {
    const capacityAvailable = botRuntime.activeCount + whatsapp.activeCount < maxSessions;
    const job = await client.claimNextJob({ capacityAvailable });
    if (!job) return false;
    try {
      if (job.job_type === "instance_create") {
        await botRuntime.createInstance(job);
      } else if (job.job_type === "pairing_start") {
        const pairingId = job.payload?.pairing_request_id;
        const phone = job.payload?.phone_e164;
        if (!pairingId || !phone || !job.bot_instance_id) throw Object.assign(new Error("invalid_pairing_job"), { code: "invalid_pairing_job" });
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
        const instances = await client.listInstances();
        const restored = await botRuntime.restoreInstances(instances.map(item => item.id));
        for (const item of restored) {
          if (item.error) {
            await client.reportInstanceStatus({ instanceId: item.id, status: "failed", errorCode: "bot_restore_failed" }).catch(() => {});
            logger?.warn?.({ instanceId: item.id, error: item.error }, "Bot instance restore failed");
          }
        }
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
