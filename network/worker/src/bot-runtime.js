import { mkdir, lstat, readFile, writeFile, chmod } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function instancePath(root, id) {
  if (!UUID.test(id || "")) throw new TypeError("invalid_instance_id");
  const base = resolve(root), target = resolve(base, id);
  if (!target.startsWith(base + sep)) throw new TypeError("invalid_instance_path");
  return target;
}
async function ensureDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("unsafe_instance_directory");
  await chmod(path, 0o700);
}
export function createBotRuntime({ dataDir, codeDir = "/opt/hasa-bot", baileys, logger, onExit = async () => {} } = {}) {
  if (!dataDir || !codeDir || !baileys?.useMultiFileAuthState) throw new TypeError("bot_runtime_configuration_required");
  const root = resolve(dataDir), codeRoot = resolve(codeDir), children = new Map();
  const healthStates = new Map(), suppressExit = new Set(), reportedExit = new Set();
  async function notifyExit(payload) {
    if (reportedExit.has(payload.instanceId)) return;
    reportedExit.add(payload.instanceId);
    if (!suppressExit.delete(payload.instanceId)) {
      try { await onExit(payload); }
      catch (error) { logger?.warn?.({ instanceId: payload.instanceId, error: error?.message }, "Bot exit callback failed"); }
    }
  }
  async function createInstance({ bot_instance_id, public_bot_id = null }) {
    const dir = instancePath(root, bot_instance_id);
    await ensureDirectory(root); await ensureDirectory(dir);
    for (const child of ["auth_info", "data", "downloads"]) await ensureDirectory(join(dir, child));
    const configPath = join(dir, "config.json");
    try {
      const existing = await lstat(configPath);
      if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("unsafe_instance_config");
      const existingConfig = JSON.parse(await readFile(configPath, "utf8"));
      if (public_bot_id && existingConfig.publicBotId !== public_bot_id) {
        existingConfig.publicBotId = public_bot_id;
        existingConfig.networkActivationPending = true;
        await writeFile(configPath, JSON.stringify(existingConfig, null, 2) + String.fromCharCode(10), { mode: 0o600 });
        await chmod(configPath, 0o600);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const template = JSON.parse(await readFile(join(codeRoot, "config.example.json"), "utf8"));
      template.owner = [];
      template.botName = "HASA BOT";
      template.downloadDir = "downloads";
      if (public_bot_id) template.publicBotId = public_bot_id;
      template.networkActivationPending = Boolean(public_bot_id);
      await writeFile(configPath, JSON.stringify(template, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    }
    return { instanceId: bot_instance_id, directory: dir };
  }
  async function getRegisteredPhone(instanceId) {
    const authDir = join(instancePath(root, instanceId), "auth_info");
    const auth = await baileys.useMultiFileAuthState(authDir);
    if (!auth.state.creds.registered) return null;
    const linkedId = auth.state.creds.me?.id || auth.state.creds.me?.jid || "";
    const phone = String(linkedId).split(":")[0].replace(/\D/g, "");
    return phone || null;
  }
  async function setOwnerPhone(instanceId, phone) {
    const ownerPhone = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
    if (!/^\d{8,15}$/.test(ownerPhone)) throw new Error("invalid_owner_phone");
    const dir = instancePath(root, instanceId);
    const configPath = join(dir, "config.json");
    const info = await lstat(configPath);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("unsafe_instance_config");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.owner = [ownerPhone];
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    await chmod(configPath, 0o600);
  }
  async function startInstance(instanceId) {
    if (children.has(instanceId)) {
      const current = children.get(instanceId);
      if (current.exitCode === null && current.signalCode === null) return { started: true, alreadyRunning: true };
      children.delete(instanceId);
    }
    reportedExit.delete(instanceId);
    healthStates.delete(instanceId);
    const dir = instancePath(root, instanceId);
    await ensureDirectory(dir);
    const authDir = join(dir, "auth_info");
    await ensureDirectory(authDir);
    const auth = await baileys.useMultiFileAuthState(authDir);
    if (!auth.state.creds.registered) { const error = new Error("whatsapp_session_not_registered"); error.code = "whatsapp_session_not_registered"; throw error; }
    const indexFile = join(codeRoot, "index.js");
    const packageFile = join(codeRoot, "package.json");
    await readFile(indexFile, "utf8");
    await readFile(packageFile, "utf8");
    const child = spawn(process.execPath, [indexFile], {
      cwd: dir,
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin",
        HOME: dir,
        NODE_ENV: "production",
        LOG_LEVEL: process.env.HASA_BOT_LOG_LEVEL || "silent",
        BOT_INSTANCE_ID: instanceId,
        BOT_HEALTH_FILE: join(dir, "data", "runtime-health.json"),
        ...(process.env.HASA_SHARED_GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.HASA_SHARED_GEMINI_API_KEY } : {})
      },
      stdio: "ignore",
      windowsHide: true
    });
    children.set(instanceId, child);
    child.once("error", error => {
      logger?.error?.({ instanceId, error: error?.message }, "Bot child process failed to start");
      if (children.get(instanceId) === child) children.delete(instanceId);
      healthStates.delete(instanceId);
      void notifyExit({ instanceId, code: null, signal: null, error: "bot_process_start_failed" });
    });
    child.once("exit", (code, signal) => {
      if (children.get(instanceId) === child) children.delete(instanceId);
      healthStates.delete(instanceId);
      void notifyExit({ instanceId, code, signal, error: code === 0 || signal === "SIGTERM" ? null : "bot_process_exited" });
    });
    return { started: true, pid: child.pid };
  }
  async function stopInstance(instanceId) {
    const child = children.get(instanceId);
    if (!child) return { stopped: true, alreadyStopped: true };
    children.delete(instanceId);
    if (child.exitCode !== null || child.signalCode !== null) return { stopped: true };
    await new Promise(resolvePromise => {
      let settled = false;
      const done = () => { if (settled) return; settled = true; clearTimeout(timer); resolvePromise(); };
      child.once("exit", done);
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} done(); }, 12_000);
      timer.unref?.();
      try { child.kill("SIGTERM"); } catch { done(); }
    });
    return { stopped: true };
  }
  async function restartInstance(instanceId) {
    await stopInstance(instanceId);
    return startInstance(instanceId);
  }
  async function collectHealthUpdates() {
    const updates = [];
    for (const [instanceId] of children) {
      try {
        const health = JSON.parse(await readFile(join(instancePath(root, instanceId), "data", "runtime-health.json"), "utf8"));
        if (health.status === "starting" && Date.now() - Date.parse(health.updated_at) > 120_000 && healthStates.get(instanceId) !== "start_timeout") {
          healthStates.set(instanceId, "start_timeout");
          updates.push({ instanceId, status: "failed", errorCode: "bot_connection_timeout" });
          try { children.get(instanceId)?.kill("SIGTERM"); } catch {}
          continue;
        }
        if (!["online", "reconnecting", "failed"].includes(health.status)) continue;
        if (healthStates.get(instanceId) === health.status) continue;
        healthStates.set(instanceId, health.status);
        updates.push({ instanceId, status: health.status === "reconnecting" ? "provisioning" : health.status, errorCode: health.error_code || null });
      } catch {}
    }
    return updates;
  }
  async function restoreInstances(instanceIds = []) {
    const results = [];
    for (const id of instanceIds) {
      try { results.push({ id, ...(await startInstance(id)) }); }
      catch (error) { results.push({ id, error: error.message }); }
    }
    return results;
  }
  async function stopAll() {
    for (const id of children.keys()) suppressExit.add(id);
    await Promise.all([...children.keys()].map(stopInstance));
  }
  return Object.freeze({ createInstance, getRegisteredPhone, setOwnerPhone, startInstance, stopInstance, restartInstance, restoreInstances, collectHealthUpdates, stopAll, get activeCount() { return children.size; }, get activeInstanceIds() { return [...children.keys()]; } });
}
