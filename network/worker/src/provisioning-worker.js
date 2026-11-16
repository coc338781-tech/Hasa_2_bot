import { setTimeout as delay } from "node:timers/promises";
import { createWhatsAppWorker } from "./whatsapp-worker.js";

export function createProvisioningWorker({ store, serverId, dataDir, baileys, pairingCodeStore, logger, maxSessions = 2, pollIntervalMs = 1500 } = {}) {
  if (!store || !serverId || !dataDir || !pairingCodeStore) throw new TypeError("worker_requires_store_server_data_dir_and_code_store");
  const activePairs = new Map();
  const whatsapp = createWhatsAppWorker({
    dataDir, baileys, logger, maxSessions,
    onPairingCode: async ({ instanceId, code, expiresAt }) => {
      const current = activePairs.get(instanceId);
      if (!current) return;
      pairingCodeStore.put({ pairingId: current.pairingId, customerId: current.customerId, code, expiresAt });
      await store.markCodeReady(current.pairingId, current.customerId);
    },
    onStatus: async ({ instanceId, status, failureCode }) => {
      const current = activePairs.get(instanceId);
      if (!current) return;
      if (status === "paired") {
        pairingCodeStore.delete(current.pairingId);
        await store.updatePairingStatus(current.pairingId, current.customerId, "paired");
        activePairs.delete(instanceId);
      } else if (status === "expired") {
        pairingCodeStore.delete(current.pairingId);
        await store.updatePairingStatus(current.pairingId, current.customerId, "expired", "pairing_expired");
        activePairs.delete(instanceId);
      } else if (status === "failed") {
        pairingCodeStore.delete(current.pairingId);
        await store.updatePairingStatus(current.pairingId, current.customerId, "failed", failureCode || "pairing_failed");
        activePairs.delete(instanceId);
      } else if (status === "offline" || status === "stopped") {
        pairingCodeStore.delete(current.pairingId);
        await store.updatePairingStatus(current.pairingId, current.customerId, "failed", "whatsapp_disconnected");
        activePairs.delete(instanceId);
      }
    }
  });
  let running = false, stopped = false, loopPromise = null;
  async function runOne() {
    const job = await store.claimNextJob(serverId, 90);
    if (!job) return false;
    const pairingId = job.payload?.pairing_request_id;
    const phone = job.payload?.phone_e164;
    if (!pairingId || !phone || !job.bot_instance_id || !job.customer_id) {
      await store.finishJob(job.id, { status: "failed", errorCode: "invalid_pairing_job" });
      return true;
    }
    activePairs.set(job.bot_instance_id, { pairingId, customerId: job.customer_id });
    try {
      await whatsapp.startPairing({ instanceId: job.bot_instance_id, phone });
      await store.finishJob(job.id, { status: "succeeded", result: { accepted: true } });
    } catch (error) {
      activePairs.delete(job.bot_instance_id);
      await store.finishJob(job.id, { status: "failed", errorCode: error.code || "worker_start_failed" });
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
