export function createPairingCodeStore({ now = () => Date.now(), maxEntries = 1000 } = {}) {
  const entries = new Map();
  function prune() {
    for (const [key, entry] of entries) if (entry.expiresAt <= now()) entries.delete(key);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }
  return Object.freeze({
    put({ pairingId, customerId, code, expiresAt }) {
      if (!pairingId || !customerId || typeof code !== "string" || !code || !Number.isFinite(Date.parse(expiresAt))) {
        throw new TypeError("invalid_pairing_code_entry");
      }
      prune();
      entries.set(pairingId, { customerId, code, expiresAt: Date.parse(expiresAt) });
    },
    take({ pairingId, customerId }) {
      prune();
      const entry = entries.get(pairingId);
      if (!entry || entry.customerId !== customerId) return null;
      entries.delete(pairingId);
      return { code: entry.code, expires_at: new Date(entry.expiresAt).toISOString() };
    },
    delete(pairingId) { return entries.delete(pairingId); },
    get size() { prune(); return entries.size; }
  });
}
