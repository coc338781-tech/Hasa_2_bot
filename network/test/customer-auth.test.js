import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, normalizeEmail, normalizePhone, createCustomerSessionToken, hashCustomerToken } from "../src/customer-auth.js";

test("customer email and phone inputs are normalized and validated", () => {
  assert.equal(normalizeEmail(" User@Example.COM "), "user@example.com");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizePhone("+94 77-123-4567"), "+94771234567");
  assert.equal(normalizePhone("0771234567"), null);
});

test("customer passwords use salted scrypt hashes and verify safely", async () => {
  const encoded = await hashPassword("a-long-customer-password");
  assert.match(encoded, /^scrypt\$/);
  assert.equal(await verifyPassword("a-long-customer-password", encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
  await assert.rejects(() => hashPassword("short"));
});

test("customer bearer tokens are random and stored as one-way hashes", () => {
  const a = createCustomerSessionToken();
  const b = createCustomerSessionToken();
  assert.notEqual(a, b);
  assert.equal(hashCustomerToken(a).length, 64);
  assert.notEqual(hashCustomerToken(a), a);
  assert.equal(hashCustomerToken("invalid"), null);
});
