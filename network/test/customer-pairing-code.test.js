import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server.js";
import { createCustomerSessionToken, hashCustomerToken } from "../src/customer-auth.js";

test("pairing code retrieval is authenticated, tenant-scoped and one-time", async () => {
  const customerId = "11111111-1111-4111-8111-111111111111";
  const pairingId = "22222222-2222-4222-8222-222222222222";
  const token = createCustomerSessionToken();
  let consumed = false, requestedOwner = null;
  const customerStore = {
    async findCustomerBySession(hash) { return hash === hashCustomerToken(token) ? { id: customerId } : null; },
    async getCustomerDashboard(id) {
      assert.equal(id, customerId);
      return { pairing_id: pairingId, pairing_status: "code_ready" };
    }
  };
  const pairingCodeStore = {
    async take({ pairingId: id, customerId: owner }) {
      requestedOwner = owner;
      if (consumed || id !== pairingId || owner !== customerId) return null;
      consumed = true;
      return { code: "ABCD-EFGH", expires_at: new Date(Date.now()+60_000).toISOString() };
    }
  };
  const server = createAppServer({ customerStore, pairingCodeStore });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const url = `${base}/v1/customer/pairing-requests/${pairingId}/code`;
  try {
    const first = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).code, "ABCD-EFGH");
    assert.equal(requestedOwner, customerId);
    const second = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(second.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
