import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server.js";
import { createCustomerSessionToken, hashCustomerToken } from "../src/customer-auth.js";
test("customer lifecycle actions derive customer identity from the authenticated session", async () => {
  const customerId = "11111111-1111-4111-8111-111111111111";
  const botId = "22222222-2222-4222-8222-222222222222";
  const token = createCustomerSessionToken();
  let queued = null;
  const customerStore = {
    async findCustomerBySession(hash) { return hash === hashCustomerToken(token) ? { id: customerId } : null; },
    async queueBotAction(input) { queued = input; return { ok: true, job_id: "33333333-3333-4333-8333-333333333333", status: "queued" }; }
  };
  const server = createAppServer({ customerStore });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/customer/bots/${botId}/actions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "restart", customer_id: "attacker-controlled" })
    });
    assert.equal(response.status, 202);
    assert.equal(queued.customerId, customerId);
    assert.equal(queued.botId, botId);
    assert.equal(queued.action, "restart");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
