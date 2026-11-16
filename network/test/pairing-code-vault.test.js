import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresPairingCodeVault } from "../src/postgres-pairing-code-vault.js";
function fakePool({ row = null } = {}) {
  const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    if (String(sql).includes("SELECT pairing_code_ciphertext")) return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    return { rowCount: 1, rows: [] };
  }, release() {} };
  return { calls, async connect() { return client; }, async query(sql, params) { return client.query(sql, params); } };
}
const key = Buffer.alloc(32, 7).toString("base64");
test("vault encrypts codes before writing and consumes them once for the matching customer", async () => {
  const pool = fakePool();
  const vault = createPostgresPairingCodeVault(pool, key);
  await vault.put({ pairingId: "pair", customerId: "customer", code: "ABCD-EFGH", expiresAt: new Date(Date.now()+60000).toISOString() });
  const write = pool.calls.find(x => x.sql.includes("UPDATE pairing_requests"));
  assert.ok(Buffer.isBuffer(write.params[2]));
  assert.notEqual(write.params[2].toString(), "ABCD-EFGH");
  assert.ok(write.sql.includes("pairing_code_auth_tag"));
});
test("vault refuses weak or missing encryption keys", () => {
  const pool = fakePool();
  assert.throws(() => createPostgresPairingCodeVault(pool, "bad"), /32-byte key/);
});
