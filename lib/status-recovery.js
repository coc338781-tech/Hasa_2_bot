import fs from "node:fs";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 2000;
const MAX_COMPLETED = 5000;

function statusId(key) {
  return [key?.remoteJid, key?.participant || "", key?.id].join(":");
}

export function createStatusRecovery(filePath = "./status-seen-recovery.json") {
  const resolvedPath = path.resolve(filePath);
  let state = { pending: {}, completed: {} };
  let writeChain = Promise.resolve();
  let flushRunning = false;

  try {
    const saved = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    state.pending = saved.pending && typeof saved.pending === "object" ? saved.pending : {};
    state.completed = saved.completed && typeof saved.completed === "object" ? saved.completed : {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Status recovery store could not be read:", error.message);
    }
  }

  function persist() {
    const snapshot = JSON.stringify(state);
    writeChain = writeChain.then(async () => {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      const tempPath = resolvedPath + ".tmp";
      fs.writeFileSync(tempPath, snapshot, "utf8");
      fs.renameSync(tempPath, resolvedPath);
    }).catch(error => {
      console.error("Status recovery store could not be saved:", error.message);
    });
    return writeChain;
  }

  function prune(now = Date.now()) {
    for (const [id, item] of Object.entries(state.pending)) {
      if (!item?.queuedAt || now - item.queuedAt > DAY_MS) delete state.pending[id];
    }
    for (const [id, completedAt] of Object.entries(state.completed)) {
      if (!completedAt || now - completedAt > DAY_MS) delete state.completed[id];
    }
    const pendingIds = Object.keys(state.pending);
    if (pendingIds.length > MAX_PENDING) {
      pendingIds.sort((a, b) => state.pending[a].queuedAt - state.pending[b].queuedAt);
      for (const id of pendingIds.slice(0, pendingIds.length - MAX_PENDING)) delete state.pending[id];
    }
    const completedIds = Object.keys(state.completed);
    if (completedIds.length > MAX_COMPLETED) {
      completedIds.sort((a, b) => state.completed[a] - state.completed[b]);
      for (const id of completedIds.slice(0, completedIds.length - MAX_COMPLETED)) delete state.completed[id];
    }
  }

  async function enqueue(message) {
    const key = message?.key;
    if (key?.remoteJid !== "status@broadcast" || !key.id) return false;
    const id = statusId(key);
    if (state.pending[id] || state.completed[id]) return false;
    const timestamp = Number(message.messageTimestamp || 0) * 1000;
    const now = Date.now();
    if (timestamp && now - timestamp > DAY_MS) return false;
    state.pending[id] = { key, queuedAt: now, messageTimestamp: timestamp || now };
    prune(now);
    await persist();
    return true;
  }

  async function flush(sock) {
    if (flushRunning || !sock || sock.ws?.isOpen === false) return;
    flushRunning = true;
    try {
      prune();
      await persist();
      const attempted = new Set();
      while (true) {
        const next = Object.entries(state.pending).find(([id]) => !attempted.has(id));
        if (!next) break;
        const [id, item] = next;
        attempted.add(id);
        try {
          await sock.readMessages([item.key]);
          delete state.pending[id];
          state.completed[id] = Date.now();
          prune();
          await persist();
        } catch (error) {
          console.error("Missed status read retry failed:", error.message);
        }
      }
    } finally {
      flushRunning = false;
    }
  }

  return { enqueue, flush };
}
