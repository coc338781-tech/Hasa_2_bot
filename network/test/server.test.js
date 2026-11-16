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
    assert.equal(body.version, "0.4.0");
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
      database: "not_configured"
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
