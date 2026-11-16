import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../src/server.js";

test("health endpoint returns service status without exposing secrets", async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");

    const body = await response.json();
    assert.equal(body.service, "hasa-bot-network-api");
    assert.equal(body.status, "ok");
    assert.equal(body.version, "0.5.0");
    assert.equal(typeof body.timestamp, "string");
    assert.equal("secrets" in body, false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("unknown routes return a JSON 404", async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/unknown`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("readiness is unavailable until persistent storage is configured", async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      service: "hasa-bot-network-api",
      ready: false,
      database: "not_configured",
      pairing_code_vault: false
    });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("owner dashboard is served with a restrictive content security policy", async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/owner`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(await response.text(), /HASA BOT NETWORK/);
    const script = await fetch(`${base}/owner.js`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /session = null/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("public website and assets are served locally with restrictive headers", async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(await page.text(), /Your WhatsApp bots/);
    const css = await fetch(`${base}/site.css`);
    assert.equal(css.status, 200);
    assert.match(await css.text(), /\.hero-art/);
    const script = await fetch(`${base}/site.js`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /menu-toggle/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("public customer website does not expose website editing controls", async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    const html = await response.text();
    assert.doesNotMatch(html, /edit website|change theme|website editor/i);
    assert.match(html, /No customer website editor/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("customer workspace is served with restrictive CSP", async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/customer`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(await response.text(), /PRIVATE CUSTOMER WORKSPACE/);
    const script = await fetch(`${base}/customer.js`);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /v1\/customer\/me/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("customer API fails closed without configured database", async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/v1/customer/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", phone: "+94771234567", password: "a-secure-password" })
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "customer_auth_unavailable" });
    const protectedResponse = await fetch(`${base}/v1/customer/me`);
    assert.equal(protectedResponse.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("customer registration, dashboard and pairing intake stay scoped to the signed-in customer", async () => {
  const { hashCustomerToken } = await import("../src/customer-auth.js");
  const customerId = "11111111-1111-4111-8111-111111111111";
  const botId = "22222222-2222-4222-8222-222222222222";
  let storedSessionHash = null;
  let pairingOwner = null;
  const store = {
    async createCustomer({ email, phone, displayName }) {
      return { id: customerId, email, phone_e164: phone, display_name: displayName, bot: { id: botId, status: "offline" } };
    },
    async createSession({ tokenHash }) { storedSessionHash = tokenHash; },
    async findCustomerBySession(tokenHash) {
      return tokenHash === storedSessionHash ? { id: customerId } : null;
    },
    async getCustomerDashboard(id) {
      assert.equal(id, customerId);
      return {
        customer_id: customerId, display_name: "Test Customer", phone_e164: "+94771234567",
        account_status: "active", login_email: "test@example.com",
        bot_id: botId, bot_status: "offline", release_version: null,
        last_started_at: null, last_stopped_at: null, last_error_code: null,
        pairing_id: null, pairing_status: null, pairing_phone: null,
        pairing_expires_at: null, pairing_created_at: null
      };
    },
    async createPairingRequest(input) {
      pairingOwner = input.customerId;
      assert.equal(input.botId, botId);
      return { ok: true, request: { id: "33333333-3333-4333-8333-333333333333", status: "queued", phone_e164: input.phone, expires_at: input.expiresAt } };
    },
    async revokeSession() { return true; }
  };
  const server = createAppServer({ customerStore: store });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const registration = await fetch(`${base}/v1/customer/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "Test@Example.com", phone: "+94 77 123 4567", display_name: "Test Customer", password: "a-long-customer-password" })
    });
    assert.equal(registration.status, 201);
    const session = await registration.json();
    assert.equal(session.authenticated, true);
    assert.equal(typeof session.access_token, "string");
    assert.equal(storedSessionHash, hashCustomerToken(session.access_token));

    const dashboard = await fetch(`${base}/v1/customer/me`, { headers: { authorization: `Bearer ${session.access_token}` } });
    assert.equal(dashboard.status, 200);
    const data = await dashboard.json();
    assert.equal(data.customer.id, customerId);
    assert.equal(data.bot.id, botId);
    assert.equal("password_hash" in data.customer, false);

    const pairing = await fetch(`${base}/v1/customer/pairing-requests`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ phone: "+94771234567" })
    });
    assert.equal(pairing.status, 202);
    assert.equal(pairingOwner, customerId);
    assert.equal((await pairing.json()).worker, "queued");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
