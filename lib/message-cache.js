import fs from "node:fs";
import path from "node:path";
import { deserialize, serialize } from "node:v8";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class PersistentMessageCache extends Map {
  constructor({
    file = path.resolve("./data/message-cache.bin"),
    maxEntries = 2000,
    ttlMs = DEFAULT_TTL_MS,
    flushDelayMs = 1000
  } = {}) {
    super();
    this.file = file;
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.flushDelayMs = flushDelayMs;
    this.savedAt = new Map();
    this.flushTimer = null;
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const snapshot = deserialize(fs.readFileSync(this.file));
      if (snapshot?.version !== 1 || !Array.isArray(snapshot.entries)) return;
      const now = Date.now();
      for (const entry of snapshot.entries) {
        if (!Array.isArray(entry) || entry.length !== 3) continue;
        const [key, savedAt, message] = entry;
        if (typeof key !== "string" || !Number.isFinite(savedAt) ||
            now - savedAt > this.ttlMs || !message?.message) continue;
        super.set(key, message);
        this.savedAt.set(key, savedAt);
      }
      this.trim();
    } catch (error) {
      console.error("Anti-delete cache restore failed:", error.message);
    }
  }

  trim() {
    while (super.size > this.maxEntries) {
      const oldestKey = super.keys().next().value;
      super.delete(oldestKey);
      this.savedAt.delete(oldestKey);
    }
  }

  set(key, message) {
    if (typeof key !== "string" || !message?.message) return this;
    if (super.has(key)) super.delete(key);
    super.set(key, message);
    this.savedAt.set(key, Date.now());
    this.trim();
    this.scheduleFlush();
    return this;
  }

  get(key) {
    if (!super.has(key)) return undefined;
    const savedAt = this.savedAt.get(key) || 0;
    if (Date.now() - savedAt > this.ttlMs) {
      this.delete(key);
      return undefined;
    }
    return super.get(key);
  }

  delete(key) {
    const existed = super.delete(key);
    this.savedAt.delete(key);
    if (existed) this.scheduleFlush();
    return existed;
  }

  clear() {
    super.clear();
    this.savedAt.clear();
    this.scheduleFlush();
  }

  scheduleFlush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const entries = [...super.entries()].map(([key, message]) => [
        key,
        this.savedAt.get(key) || Date.now(),
        message
      ]);
      const temporary = this.file + ".tmp";
      fs.writeFileSync(temporary, serialize({ version: 1, entries }));
      fs.renameSync(temporary, this.file);
      return true;
    } catch (error) {
      console.error("Anti-delete cache save failed:", error.message);
      try { fs.unlinkSync(this.file + ".tmp"); } catch {}
      return false;
    }
  }
}
