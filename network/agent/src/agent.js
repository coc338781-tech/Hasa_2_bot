import os from "node:os";
import { statfs, mkdir, open, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const VERSION = "0.2.0";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getAvailableMemoryBytes({ readFileImpl = readFile, fallback = os.freemem } = {}) {
  if (os.platform() === "linux") {
    try {
      const meminfo = await readFileImpl("/proc/meminfo", "utf8");
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo);
      if (match) {
        const bytes = Number(match[1]) * 1024;
        if (Number.isSafeInteger(bytes) && bytes >= 0) return bytes;
      }
    } catch {}
  }
  return fallback();
}

export async function collectTelemetry(dataPath = process.env.HASA_AGENT_DATA_PATH || "/") {
  const disk = await statfs(dataPath);
  const totalBlocks = Number(disk.blocks);
  const availableBlocks = Number(disk.bavail);
  const blockSize = Number(disk.bsize);
  return {
    hostname: hostname(),
    os_name: os.type(),
    os_release: os.release(),
    architecture: os.arch(),
    agent_version: VERSION,
    cpu_cores: os.cpus().length,
    load_average: os.loadavg().map(value => Number(value.toFixed(2))),
    memory_total_bytes: os.totalmem(),
    memory_available_bytes: await getAvailableMemoryBytes(),
    disk_total_bytes: totalBlocks * blockSize,
    disk_available_bytes: availableBlocks * blockSize,
    observed_at: new Date().toISOString()
  };
}

function apiBase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("HASA_AGENT_API_URL must be a valid URL"); }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("The server agent requires HTTPS except for localhost development");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("API URL must not contain credentials, query parameters or fragments");
  return url.origin;
}

async function postJson(fetchImpl, url, body, token) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  });
  let result;
  try { result = await response.json(); } catch { throw new Error("Central API returned an invalid response"); }
  if (!response.ok) throw new Error(`Central API request failed (${response.status}): ${result.error || "request_failed"}`);
  return result;
}

export async function saveCredentials(path, credentials) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW || 0), 0o600);
  try {
    await handle.chmod(0o600);
    await handle.truncate(0);
    await handle.writeFile(JSON.stringify(credentials) + "\n", "utf8");
  } finally {
    await handle.close();
  }
}

export async function loadCredentials(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const parsed = JSON.parse(await handle.readFile("utf8"));
    if (!UUID_RE.test(parsed?.server_id || "") || typeof parsed?.agent_token !== "string" || parsed.agent_token.length < 32) {
      throw new Error("Agent credential file is invalid");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code === "ELOOP") throw new Error("Agent credential file must not be a symbolic link");
    if (error.message === "Agent credential file is invalid") throw error;
    throw new Error("Unable to read the agent credential file");
  } finally {
    await handle?.close();
  }
}

export async function enrollAgent({ baseUrl, ticket, credentialPath, fetchImpl = fetch }) {
  if (typeof ticket !== "string" || ticket.length < 32 || ticket.length > 256) throw new Error("A valid enrollment ticket is required");
  const result = await postJson(fetchImpl, `${baseUrl}/v1/agent/enroll`, { ticket });
  if (!UUID_RE.test(result.server_id || "") || typeof result.agent_token !== "string" || result.agent_token.length < 32) {
    throw new Error("Central API returned invalid enrollment credentials");
  }
  const credentials = { server_id: result.server_id, agent_token: result.agent_token };
  await saveCredentials(credentialPath, credentials);
  return { server_id: credentials.server_id, server_label: result.server_label };
}

export async function sendHeartbeat({ baseUrl, credentials, fetchImpl = fetch, dataPath }) {
  const telemetry = await collectTelemetry(dataPath);
  const payload = { ...telemetry, server_id: credentials.server_id, request_id: randomUUID() };
  return postJson(fetchImpl, `${baseUrl}/v1/agent/heartbeat`, payload, credentials.agent_token);
}

export async function runAgent({ env = process.env, fetchImpl = fetch, signal } = {}) {
  const baseUrl = apiBase(env.HASA_AGENT_API_URL);
  const credentialPath = env.HASA_AGENT_TOKEN_FILE || `${env.HOME || os.homedir()}/.config/hasa-agent/credentials.json`;
  let credentials = await loadCredentials(credentialPath);
  if (!credentials) {
    const enrolled = await enrollAgent({
      baseUrl,
      ticket: env.HASA_AGENT_ENROLLMENT_TICKET,
      credentialPath,
      fetchImpl
    });
    process.stdout.write(`HASA server enrolled: ${enrolled.server_label || enrolled.server_id}\n`);
    credentials = await loadCredentials(credentialPath);
  }

  const configured = Number(env.HASA_AGENT_INTERVAL_SECONDS || 60);
  if (!Number.isInteger(configured) || configured < 15 || configured > 3600) {
    throw new Error("HASA_AGENT_INTERVAL_SECONDS must be between 15 and 3600");
  }
  const interval = configured * 1000;
  while (!signal?.aborted) {
    try {
      const result = await sendHeartbeat({ baseUrl, credentials, fetchImpl, dataPath: env.HASA_AGENT_DATA_PATH || "/" });
      if (result.accepted !== true) throw new Error("Central API did not acknowledge the heartbeat");
      process.stdout.write(`HASA server heartbeat accepted: ${result.server_id}\n`);
    } catch (error) {
      console.error("HASA server heartbeat failed:", error.message);
    }
    if (signal?.aborted) break;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, interval);
      timer.unref?.();
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  runAgent({ signal: controller.signal }).catch(error => {
    console.error("HASA Server Agent:", error.message);
    process.exitCode = 1;
  });
}
