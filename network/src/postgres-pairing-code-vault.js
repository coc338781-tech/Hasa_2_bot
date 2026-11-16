import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function decodeKey(value) {
  if (typeof value !== "string") throw new Error("HASA_PAIRING_CODE_KEY is required");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) throw new Error("HASA_PAIRING_CODE_KEY must be a base64-encoded 32-byte key");
  return key;
}
function encrypt(code, key) {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}
function decrypt(row, key) {
  const decipher = createDecipheriv("aes-256-gcm", key, row.pairing_code_nonce);
  decipher.setAuthTag(row.pairing_code_auth_tag);
  return Buffer.concat([decipher.update(row.pairing_code_ciphertext), decipher.final()]).toString("utf8");
}
export function createPostgresPairingCodeVault(pool, encodedKey) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL Pool-compatible object is required");
  const key = decodeKey(encodedKey);
  return Object.freeze({
    async put({ pairingId, customerId, code, expiresAt }) {
      if (typeof code !== "string" || code.length < 4 || code.length > 32) throw new TypeError("invalid_pairing_code");
      const encrypted = encrypt(code, key);
      const result = await pool.query(
        `UPDATE pairing_requests
            SET pairing_code_ciphertext = $3, pairing_code_nonce = $4, pairing_code_auth_tag = $5,
                pairing_code_key_version = 'v1', expires_at = LEAST(expires_at, $6), updated_at = now()
          WHERE id = $1 AND customer_id = $2 AND status = 'generating' AND expires_at > now()
          RETURNING id`,
        [pairingId, customerId, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, expiresAt]);
      if (result.rowCount !== 1) throw new Error("pairing_request_not_active");
    },
    async take({ pairingId, customerId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query(
          `SELECT pairing_code_ciphertext, pairing_code_nonce, pairing_code_auth_tag, expires_at
             FROM pairing_requests
            WHERE id = $1 AND customer_id = $2 AND status = 'code_ready'
              AND expires_at > now() AND pairing_code_ciphertext IS NOT NULL
            FOR UPDATE`, [pairingId, customerId]);
        if (found.rowCount !== 1) { await client.query("ROLLBACK"); return null; }
        const code = decrypt(found.rows[0], key);
        await client.query(
          `UPDATE pairing_requests SET pairing_code_ciphertext = NULL, pairing_code_nonce = NULL,
             pairing_code_auth_tag = NULL, pairing_code_key_version = NULL, updated_at = now()
            WHERE id = $1 AND customer_id = $2`, [pairingId, customerId]);
        await client.query("COMMIT");
        return { code, expires_at: new Date(found.rows[0].expires_at).toISOString() };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async delete(pairingId) {
      await pool.query(
        `UPDATE pairing_requests SET pairing_code_ciphertext = NULL, pairing_code_nonce = NULL,
           pairing_code_auth_tag = NULL, pairing_code_key_version = NULL, updated_at = now()
          WHERE id = $1`, [pairingId]);
    }
  });
}
