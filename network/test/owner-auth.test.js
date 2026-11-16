import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server.js";

const ownerKey = "owner-access-key-for-tests-only-0123456789abcdef";

test("owner login issues a short-lived signed session and protects ticket creation", async () => {
  const previous = process.env.HASA_OWNER_ACCESS_KEY;
  process.env.HASA_OWNER_ACCESS_KEY = ownerKey;
  let saved;
  const store = {
    async createEnrollmentTicket(input) { saved = input; },
    async listServers() { return [{ id: "123e4567-e89b-42d3-a456-426614174000", status: "online" }]; },
    async revokeServer(id) { return id === "123e4567-e89b-42d3-a456-426614174000"; }
  };
  const server = createAppServer({ agentStore: store, clock: () => Date.parse("2026-11-16T18:00:00.000Z") });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const denied = await fetch(base + "/v1/owner/server-enrollment-tickets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Oracle", provider: "Oracle" })
    });
    assert.equal(denied.status, 401);

    const badLogin = await fetch(base + "/v1/owner/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: "wrong-owner-key-which-is-long-enough-000000000000" })
    });
    assert.equal(badLogin.status, 401);

    const login = await fetch(base + "/v1/owner/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: ownerKey })
    });
    assert.equal(login.status, 200);
    const session = await login.json();
    assert.equal(session.authenticated, true);
    assert.equal(session.expires_in_seconds, 1800);

    const created = await fetch(base + "/v1/owner/server-enrollment-tickets", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Oracle primary", provider: "Oracle Cloud" })
    });
    assert.equal(created.status, 201);
    const ticket = await created.json();
    assert.equal(ticket.uses, 1);
    assert.equal(ticket.label, "Oracle primary");
    assert.equal(saved.ticketHash.length, 64);
    assert.notEqual(saved.ticketHash, ticket.ticket);
    const inventory = await fetch(base + "/v1/owner/servers", {
      headers: { Authorization: "Bearer " + session.access_token }
    });
    assert.equal(inventory.status, 200);
    assert.equal((await inventory.json()).servers[0].status, "online");

    const revoke = await fetch(base + "/v1/owner/servers/123e4567-e89b-42d3-a456-426614174000/revoke", {
      method: "POST", headers: { Authorization: "Bearer " + session.access_token }
    });
    assert.equal(revoke.status, 200);
    assert.equal((await revoke.json()).revoked, true);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.HASA_OWNER_ACCESS_KEY;
    else process.env.HASA_OWNER_ACCESS_KEY = previous;
  }
});

test("owner login is disabled when no strong bootstrap key is configured", async () => {
  const previous = process.env.HASA_OWNER_ACCESS_KEY;
  delete process.env.HASA_OWNER_ACCESS_KEY;
  const server = createAppServer({ clock: () => Date.now() });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/owner/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: ownerKey })
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previous !== undefined) process.env.HASA_OWNER_ACCESS_KEY = previous;
  }
});
