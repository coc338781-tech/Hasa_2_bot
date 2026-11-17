import pino from "pino";
import * as baileys from "@whiskeysockets/baileys";
import { createProvisioningWorker } from "./provisioning-worker.js";
import { createAgentWorkerClient } from "./agent-client.js";

const dataDir = process.env.HASA_WHATSAPP_DATA_DIR;
if (process.env.HASA_WHATSAPP_DATA_ENCRYPTED !== "true" || !dataDir) {
  throw new Error("Set HASA_WHATSAPP_DATA_DIR to an encrypted volume and confirm HASA_WHATSAPP_DATA_ENCRYPTED=true");
}
const client = createAgentWorkerClient({
  apiUrl: process.env.HASA_AGENT_API_URL,
  token: process.env.HASA_AGENT_TOKEN
});
const logger = pino({ level: process.env.LOG_LEVEL || "warn" });
const worker = createProvisioningWorker({
  client, dataDir, codeDir: process.env.HASA_BOT_CODE_DIR || "/opt/hasa-bot", baileys, logger,
  maxSessions: Number(process.env.HASA_WORKER_MAX_SESSIONS || 1),
  minFreeMemoryBytes: Number(process.env.HASA_MIN_FREE_MEMORY_BYTES || 268435456)
});
await worker.start();
logger.info({ activeSessions: worker.activeCount }, "HASA BOT NETWORK worker started");
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Stopping worker");
  await worker.stop();
  process.exitCode = 0;
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
