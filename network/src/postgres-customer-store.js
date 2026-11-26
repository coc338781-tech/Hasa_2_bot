import { randomUUID } from "node:crypto";
import { createPostgresProvisioningStore } from "./postgres-provisioning-store.js";
export function createPostgresCustomerStore(pool) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL Pool-compatible object is required");
  const provisioning = createPostgresProvisioningStore(pool);
  return {
    assignBotToServer: provisioning.assignBotToServer,
    queueBotAction: provisioning.queueBotAction,
    async createCustomer({ email, phone, displayName, passwordHash }) {
      const client = await pool.connect();
      const customerId = randomUUID();
      const instanceId = randomUUID();
      const instanceKey = randomUUID();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO customers (id, display_name, phone_e164, status) VALUES ($1, $2, $3, 'active')`,
          [customerId, displayName || null, phone]
        );
        await client.query(
          `INSERT INTO customer_accounts (id, customer_id, login_email, password_hash) VALUES ($1, $2, $3, $4)`,
          [randomUUID(), customerId, email, passwordHash]
        );
        await client.query(
          `INSERT INTO bot_instances (id, customer_id, product_code, status, instance_key)
           VALUES ($1, $2, 'hasa-bot', 'offline', $3)`,
          [instanceId, customerId, instanceKey]
        );
        await client.query("COMMIT");
        return { id: customerId, email, phone_e164: phone, display_name: displayName || null, bot: { id: instanceId, status: "offline" } };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async createCustomerByPhone({ phone, displayName = null }) {
      const client = await pool.connect();
      const customerId = randomUUID();
      const instanceId = randomUUID();
      const instanceKey = randomUUID();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO customers (id, display_name, phone_e164, status) VALUES ($1, $2, $3, 'active')`,
          [customerId, displayName, phone]
        );
        await client.query(
          `INSERT INTO bot_instances (id, customer_id, product_code, status, instance_key)
           VALUES ($1, $2, 'hasa-bot', 'offline', $3)`,
          [instanceId, customerId, instanceKey]
        );
        await client.query("COMMIT");
        const assignment = await provisioning.assignBotToAvailableServer({ botId: instanceId });
        return {
          id: customerId, phone_e164: phone, display_name: displayName,
          bot: { id: instanceId, status: assignment.ok ? "provisioning" : "offline", server_assigned: assignment.ok }
        };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async findCustomerByPhone(phone) {
      const result = await pool.query(
        `SELECT c.id, c.phone_e164, c.display_name, c.status, COALESCE(b.whatsapp_registered, false) AS whatsapp_registered
           FROM customers c LEFT JOIN bot_instances b ON b.customer_id = c.id
          WHERE c.phone_e164 = $1 LIMIT 1`, [phone]);
      return result.rows[0] || null;
    },
    async findAccountByEmail(email) {
      const result = await pool.query(
        `SELECT a.customer_id, a.login_email, a.password_hash, a.disabled_at,
                c.phone_e164, c.display_name, c.status AS customer_status
           FROM customer_accounts a JOIN customers c ON c.id = a.customer_id
          WHERE a.login_email = $1 LIMIT 1`, [email]);
      return result.rows[0] || null;
    },
    async createSession({ customerId, tokenHash, expiresAt }) {
      await pool.query(
        `INSERT INTO customer_sessions (id, customer_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), customerId, tokenHash, expiresAt]);
    },
    async findCustomerBySession(tokenHash, now = new Date()) {
      const result = await pool.query(
        `SELECT c.id, c.phone_e164, c.display_name, c.status
           FROM customer_sessions s
           JOIN customers c ON c.id = s.customer_id
          WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
            AND c.status = 'active' LIMIT 1`,
        [tokenHash, now]);
      if (!result.rows[0]) return null;
      await pool.query("UPDATE customer_sessions SET last_seen_at = $2 WHERE token_hash = $1", [tokenHash, now]);
      return result.rows[0];
    },
    async revokeSession(tokenHash) {
      const result = await pool.query(
        `UPDATE customer_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id`,
        [tokenHash]);
      return result.rowCount === 1;
    },
    async getCustomerDashboard(customerId) {
      await provisioning.expireStalePairings(customerId);
      const result = await pool.query(
        `SELECT c.id AS customer_id, c.display_name, c.phone_e164, c.status AS account_status,
                b.id AS bot_id, b.status AS bot_status, b.whatsapp_registered, b.runtime_provisioned, (b.server_id IS NOT NULL) AS server_assigned, b.release_version,
                b.last_started_at, b.last_stopped_at, b.last_error_code,
                p.id AS pairing_id, p.status AS pairing_status, p.phone_e164 AS pairing_phone,
                p.expires_at AS pairing_expires_at, p.created_at AS pairing_created_at
           FROM customers c
           LEFT JOIN bot_instances b ON b.customer_id = c.id
           LEFT JOIN LATERAL (
             SELECT id, status, phone_e164, expires_at, created_at
               FROM pairing_requests WHERE customer_id = c.id
              ORDER BY created_at DESC LIMIT 1
           ) p ON true
          WHERE c.id = $1 LIMIT 1`, [customerId]);
      return result.rows[0] || null;
    },
    async listCustomers() {
      const result = await pool.query(
        `SELECT c.id, c.display_name, c.phone_e164, c.status, c.created_at,
                b.id AS bot_id, b.status AS bot_status,
                b.whatsapp_registered, b.runtime_provisioned, s.label AS server_label
           FROM customers c
           LEFT JOIN bot_instances b ON b.customer_id = c.id
           LEFT JOIN servers s ON s.id = b.server_id
          ORDER BY c.created_at DESC LIMIT 1000`);
      return result.rows;
    },
    async createPairingRequest({ customerId, botId, phone, expiresAt }) {
      return provisioning.enqueuePairing({ customerId, botId, phone, expiresAt });
    }
  };
}
