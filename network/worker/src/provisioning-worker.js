import { setTimeout as delay } from "node:timers/promises";
import { createWhatsAppWorker } from "./whatsapp-worker.js";

export function createProvisioningWorker({ client, dataDir, baileys, logger, maxSessions = 2, pollIntervalMs = 1500 } = {}) {
  if (!client || !dataDir) throw new TypeError("worker_requires_agent_client_and_data_dir");
  const activePairs = new Map();
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
        if (status !== "paired") activePairs.delete(instanceId);
      }
    }
  });
  let running = false, stopped = false, loopPromise = null;
  async function runOne() {
    const job = await client.claimNextJob();
    if (!job) return false;
    const pairingId = job.payload?.pairing_request_id;
    const phone = job.payload?.phone_e164;
    if (!pairingId || !phone || !job.bot_instance_id) {
      await client.finishJob(job.id, { status: "failed", errorCode: "invalid_pairing_job" });
      return true;
    }
    activePairs.set(job.bot_instance_id, { pairingId, jobId: job.id });
    try {
      await whatsapp.startPairing({ instanceId: job.bot_instance_id, phone });
      await client.finishJob(job.id, { status: "succeeded", result: { accepted: true } });
    } catch (error) {
      activePairs.delete(job.bot_instance_id);
      await client.finishJob(job.id, { status: "failed", errorCode: error.code || "worker_start_failed" });
      logger?.warn?.({ jobId: job.id, error: error?.message }, "Pairing job failed");
    }
    return true;
  }
  async function loop() {
    while (!stopped) {
      try {
        const worked = await runOne();
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
      running = true; stopped = false; loopPromise = loop();
    },
    async stop() {
      stopped = true;
      await whatsapp.stopAll();
      if (loopPromise) await loopPromise;
      running = false;
    },
    get activeCount() { return whatsapp.activeCount; }
  });
}
