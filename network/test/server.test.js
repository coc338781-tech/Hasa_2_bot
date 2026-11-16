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
    assert.equal(body.version, "0.3.0");
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
