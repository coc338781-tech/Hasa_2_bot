import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWhatsAppWorker } from "../src/whatsapp-worker.js";
function fakeBaileys() {
  const sockets = [];
  return { sockets, default(options) {
    const handlers = new Map();
    const socket = { options, ev: { on(name, fn) { handlers.set(name, fn); } }, async requestPairingCode(phone) { socket.requestedPhone = phone; return "ABCD-EFGH"; }, end() { socket.ended = true; }, emit(name, value) { return handlers.get(name)?.(value); } };
    sockets.push(socket); return socket;
  }, async useMultiFileAuthState() { return { state: { creds: { registered: false }, keys: {} }, saveCreds: async () => {} }; } };
}
test("worker generates a real pairing code after Baileys readiness and never puts it in status", async () => {
  const root = await mkdtemp(join(tmpdir(), "hasa-worker-")), baileys = fakeBaileys(), codes = [], statuses = [];
  const worker = createWhatsAppWorker({ dataDir: root, baileys, pairingTimeoutMs: 60_000, onPairingCode: async x => codes.push(x), onStatus: async x => statuses.push(x) });
  const id = "11111111-1111-4111-8111-111111111111";
  try {
    await worker.startPairing({ instanceId: id, phone: "+94771234567" });
    assert.equal(worker.getStatus(id).status, "pairing");
    await baileys.sockets[0].emit("connection.update", { qr: "readiness-signal" });
    assert.equal(codes.length, 1); assert.equal(codes[0].code, "ABCD-EFGH");
    assert.equal(baileys.sockets[0].requestedPhone, "94771234567");
    assert.equal(JSON.stringify(statuses).includes("ABCD-EFGH"), false);
    await baileys.sockets[0].emit("connection.update", { connection: "open" });
    assert.equal(worker.getStatus(id).status, "offline");
    assert.ok(statuses.some(item => item.status === "paired"));
    assert.equal(worker.activeCount, 0);
  } finally { await worker.stopAll(); await rm(root, { recursive: true, force: true }); }
});
test("worker validates tenant instance IDs and phone numbers and enforces capacity", async () => {
  const root = await mkdtemp(join(tmpdir(), "hasa-worker-")), baileys = fakeBaileys();
  const worker = createWhatsAppWorker({ dataDir: root, baileys, maxSessions: 1 });
  try {
    await assert.rejects(worker.startPairing({ instanceId: "../other", phone: "+94771234567" }), /invalid_instance_id/);
    await assert.rejects(worker.startPairing({ instanceId: "11111111-1111-4111-8111-111111111111", phone: "0771234567" }), /invalid_phone/);
    await worker.startPairing({ instanceId: "11111111-1111-4111-8111-111111111111", phone: "+94771234567" });
    await assert.rejects(worker.startPairing({ instanceId: "22222222-2222-4222-8222-222222222222", phone: "+94771234567" }), /worker_capacity_reached/);
  } finally { await worker.stopAll(); await rm(root, { recursive: true, force: true }); }
});
