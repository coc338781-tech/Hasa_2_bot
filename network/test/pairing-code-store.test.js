import test from "node:test";
import assert from "node:assert/strict";
import { createPairingCodeStore } from "../src/pairing-code-store.js";
test("pairing codes are one-time and only available to the owning customer", () => {
  let now = 1000;
  const store = createPairingCodeStore({ now: () => now });
  store.put({ pairingId: "pair-1", customerId: "customer-1", code: "ABCD-EFGH", expiresAt: new Date(5000).toISOString() });
  assert.equal(store.take({ pairingId: "pair-1", customerId: "customer-2" }), null);
  assert.equal(store.take({ pairingId: "pair-1", customerId: "customer-1" }).code, "ABCD-EFGH");
  assert.equal(store.take({ pairingId: "pair-1", customerId: "customer-1" }), null);
});
test("expired pairing codes are removed", () => {
  let now = 1000;
  const store = createPairingCodeStore({ now: () => now });
  store.put({ pairingId: "pair-1", customerId: "customer-1", code: "ABCD-EFGH", expiresAt: new Date(1500).toISOString() });
  now = 1501;
  assert.equal(store.take({ pairingId: "pair-1", customerId: "customer-1" }), null);
  assert.equal(store.size, 0);
});
