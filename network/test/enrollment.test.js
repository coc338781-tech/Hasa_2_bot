import test from "node:test";
import assert from "node:assert/strict";
import { exchangeEnrollmentTicket, hashSecret } from "../src/enrollment.js";
import { createAppServer } from "../src/server.js";

const ticket = "single-use-enrollment-ticket-secret-0123456789";
const now = Date.parse("2026-11-16T18:00:00.000Z");

test("enrollment exchanges a one-time ticket and returns the agent token once", async () => {
  let saved;
  const store = { async consumeEnrollmentTicket(input) {
    saved = input;
    return input.ticketHash === hashSecret(ticket) ? { label: "Oracle primary", provider: "Oracle" } : null;
  }};
  const result = await exchangeEnrollmentTicket({ ticket, store, now });
  assert.equal(result.status, 200);
  assert.equal(result.body.server_label, "Oracle primary");
  assert.equal(result.body.provider, "Oracle");
  assert.equal(typeof result.body.agent_token, "string");
  assert.ok(result.body.agent_token.length >= 40);
  assert.equal(saved.tokenHash, hashSecret(result.body.agent_token));
});

test("enrollment rejects invalid and already-used tickets", async () => {
  assert.equal((await exchangeEnrollmentTicket({ ticket: "short", store: {} })).status, 400);
  assert.equal((await exchangeEnrollmentTicket({ ticket, store: { async consumeEnrollmentTicket() { return null; } } })).status, 401);
});

test("HTTP enrollment route is rate limited and does not reveal a token for invalid tickets", async () => {
  const store = { async consumeEnrollmentTicket() { return null; } };
  const server = createAppServer({ agentStore: store, clock: () => now });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/agent/enroll`;
    let last;
    for (let i = 0; i < 6; i++) {
      last = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket }) });
    }
    assert.equal(last.status, 429);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
