import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresPairingCodeVault } from "../src/postgres-pairing-code-vault.js";
function fakePool() {
  const calls = [];
  let row = null;
  const client = { async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ sql: normalized, params });
    if (normalized.includes("SELECT pairing_code_ciphertext")) return { rowCount: row && row.customerId === params[1] ? 1 : 0, rows: row && row.customerId === params[1] ? [{ ...row }] : [] };
    if (normalized.includes("SET pairing_code_ciphertext = $3")) {
      row = { customerId: params[1], pairing_code_ciphertext: params[2], pairing_code_nonce: params[3], pairing_code_auth_tag: params[4], expires_at: params[5] };
      return { rowCount: 1, rows: [{ id: params[0] }] };
    }
    if (normalized.includes("SET pairing_code_ciphertext = NULL")) { row = null; return { rowCount: 1, rows: [] }; }
    return { rowCount: 1, rows: [] };
  }, release() {} };
  return { calls, async connect() { return client; }, async query(sql, params) { return client.query(sql, params); } };
}
const key = Buffer.alloc(32, 7).toString("base64");
test("vault encrypts codes at rest and consumes them once for the owning customer", async () => {
  const pool = fakePool(), vault = createPostgresPairingCodeVault(pool, key);
  const expiresAt = new Date(Date.now()+60_000).toISOString();
  await vault.put({ pairingId: "pair", customerId: "customer", code: "ABCD-EFGH", expiresAt });
  const write = pool.calls.find(x => x.sql.includes("SET pairing_code_ciphertext = $3"));
  assert.ok(Buffer.isBuffer(write.params[2]));
  assert.notEqual(write.params[2].toString(), "ABCD-EFGH");
  assert.ok(write.sql.includes("pairing_code_auth_tag"));
  assert.equal(await vault.take({ pairingId: "pair", customerId: "someone-else" }), null);
  const result = await vault.take({ pairingId: "pair", customerId: "customer" });
  assert.equal(result.code, "ABCD-EFGH");
  assert.equal(await vault.take({ pairingId: "pair", customerId: "customer" }), null);
});
test("vault refuses weak or missing encryption keys", () => {
  assert.throws(() => createPostgresPairingCodeVault(fakePool(), "bad"), /32-byte key/);
});
