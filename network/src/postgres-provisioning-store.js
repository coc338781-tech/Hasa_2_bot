import { randomUUID } from "node:crypto";

const MIN_FREE_MEMORY_BYTES = Number(process.env.HASA_MIN_FREE_MEMORY_BYTES || 768 * 1024 * 1024);
if (!Number.isSafeInteger(MIN_FREE_MEMORY_BYTES) || MIN_FREE_MEMORY_BYTES < 0) throw new Error("HASA_MIN_FREE_MEMORY_BYTES must be a non-negative safe integer");

export function createPostgresProvisioningStore(pool) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    throw new TypeError("A PostgreSQL Pool-compatible object is required");
  }
  return {
    async assignBotToServer({ botId, serverId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const server = await client.query(
          `SELECT id, memory_available_bytes FROM servers
            WHERE id = $1 AND status = 'online'
              AND last_heartbeat_at > now() - interval '150 seconds'
            FOR UPDATE`, [serverId]);
        if (server.rowCount !== 1) { await client.query("ROLLBACK"); return { ok: false, reason: "server_not_online" }; }
        if (Number(server.rows[0].memory_available_bytes || 0) < MIN_FREE_MEMORY_BYTES) { await client.query("ROLLBACK"); return { ok: false, reason: "server_low_memory" }; }
        const bot = await client.query(
          `UPDATE bot_instances SET server_id = $2, status = 'offline', updated_at = now()
            WHERE id = $1 AND status IN ('offline','failed')
            RETURNING id, customer_id, server_id`, [botId, serverId]);
        if (bot.rowCount !== 1) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_not_assignable" }; }
        const customer = await client.query("SELECT phone_e164 FROM customers WHERE id = $1", [bot.rows[0].customer_id]);
        await client.query(
          `INSERT INTO provisioning_jobs (id, server_id, bot_instance_id, customer_id, job_type, payload)
           VALUES ($1, $2, $3, $4, 'instance_create', $5::jsonb)`,
          [randomUUID(), serverId, botId, bot.rows[0].customer_id, JSON.stringify({ owner_phone: customer.rows[0]?.phone_e164 || null })]);
        await client.query(
          `INSERT INTO audit_events (action, resource_type, resource_id, outcome, metadata)
           VALUES ('bot.assign_server', 'bot_instance', $1, 'success', jsonb_build_object('server_id', $2))`,
          [botId, serverId]);
        await client.query("COMMIT");
        return { ok: true, bot: bot.rows[0] };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async enqueuePairing({ customerId, botId, phone, expiresAt }) {
      const client = await pool.connect();
      const pairingId = randomUUID(), jobId = randomUUID();
      try {
        await client.query("BEGIN");
        const owned = await client.query(
          `SELECT b.id, b.server_id, s.status AS server_status, s.last_heartbeat_at
             FROM bot_instances b LEFT JOIN servers s ON s.id = b.server_id
            WHERE b.id = $1 AND b.customer_id = $2 FOR UPDATE OF b`, [botId, customerId]);
        if (owned.rowCount !== 1) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_not_found" }; }
        const server = owned.rows[0];
        if (!server.server_id || server.server_status !== "online" ||
            !server.last_heartbeat_at || Date.now() - new Date(server.last_heartbeat_at).getTime() > 150_000) {
          await client.query("ROLLBACK"); return { ok: false, reason: "server_unavailable" };
        }
        await client.query(
          `UPDATE pairing_requests SET status = 'cancelled', updated_at = now()
            WHERE bot_instance_id = $1 AND status IN ('queued','generating','code_ready')`, [botId]);
        await client.query(
          `UPDATE provisioning_jobs SET status = 'cancelled', updated_at = now(), completed_at = now()
            WHERE bot_instance_id = $1 AND job_type = 'pairing_start' AND status IN ('queued','leased','running')`, [botId]);
        await client.query(
          `INSERT INTO pairing_requests (id, customer_id, bot_instance_id, phone_e164, status, expires_at)
           VALUES ($1, $2, $3, $4, 'queued', $5)`, [pairingId, customerId, botId, phone, expiresAt]);
        await client.query(
          `INSERT INTO provisioning_jobs (id, server_id, bot_instance_id, customer_id, job_type, payload)
           VALUES ($1, $2, $3, $4, 'pairing_start', $5::jsonb)`,
          [jobId, server.server_id, botId, customerId, JSON.stringify({ pairing_request_id: pairingId, phone_e164: phone })]);
        await client.query("UPDATE bot_instances SET status = 'pairing', updated_at = now() WHERE id = $1", [botId]);
        await client.query("COMMIT");
        return { ok: true, request: { id: pairingId, status: "queued", phone_e164: phone, expires_at: expiresAt } };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async claimNextJob(serverId, leaseSeconds = 90) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `WITH candidate AS (
             SELECT id FROM provisioning_jobs
              WHERE server_id = $1 AND job_type IN ('instance_create','pairing_start','instance_start','instance_stop','instance_restart')
                AND ((status = 'queued' AND available_at <= now())
                  OR (status = 'leased' AND lease_expires_at < now()))
                AND attempts < 5
              ORDER BY created_at
              FOR UPDATE SKIP LOCKED LIMIT 1
           )
           UPDATE provisioning_jobs j
              SET status = 'leased', attempts = attempts + 1,
                  lease_expires_at = now() + ($2 * interval '1 second'), updated_at = now()
             FROM candidate c WHERE j.id = c.id
           RETURNING j.id, j.bot_instance_id, j.customer_id, j.job_type, j.payload, j.attempts`,
          [serverId, leaseSeconds]);
        if (claimed.rowCount !== 1) { await client.query("COMMIT"); return null; }
        const job = claimed.rows[0];
        await client.query(
          `UPDATE provisioning_jobs SET status = 'running', updated_at = now()
            WHERE id = $1 AND status = 'leased'`, [job.id]);
        if (job.job_type === "pairing_start") {
          await client.query(
            `UPDATE pairing_requests SET status = 'generating', attempts = LEAST(attempts + 1, 10), updated_at = now()
              WHERE id = $1 AND customer_id = $2 AND status = 'queued'`,
            [job.payload.pairing_request_id, job.customer_id]);
        }
        await client.query("COMMIT");
        return job;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async finishJob(jobId, serverId, { status, result = null, errorCode = null } = {}) {
      if (!["succeeded", "failed", "cancelled"].includes(status)) throw new TypeError("invalid_job_status");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query(
          `SELECT bot_instance_id, customer_id, job_type, payload
             FROM provisioning_jobs WHERE id = $1 AND server_id = $2 FOR UPDATE`, [jobId, serverId]);
        if (!found.rowCount) { await client.query("ROLLBACK"); return false; }
        const job = found.rows[0];
        await client.query(
          `UPDATE provisioning_jobs SET status = $2, result = $3::jsonb, updated_at = now(),
             completed_at = now(), lease_expires_at = NULL WHERE id = $1 AND server_id = $4`,
          [jobId, status, result ? JSON.stringify(result) : null, serverId]);
        if (status === "failed") {
          await client.query(
            `UPDATE bot_instances SET status = 'failed', last_error_code = $2, updated_at = now()
              WHERE id = $1`, [job.bot_instance_id, errorCode || "worker_failed"]);
          if (job.job_type === "pairing_start") {
            await client.query(
              `UPDATE pairing_requests SET status = 'failed', failure_code = $2, updated_at = now()
                WHERE id = $1 AND status IN ('queued','generating')`,
              [job.payload.pairing_request_id, errorCode || "worker_failed"]);
          }
        } else if (status === "succeeded") {
          if (job.job_type === "instance_create") {
            await client.query("UPDATE bot_instances SET status = 'offline', last_error_code = NULL, updated_at = now() WHERE id = $1", [job.bot_instance_id]);
          } else if (job.job_type === "instance_start" || job.job_type === "instance_restart") {
            await client.query("UPDATE bot_instances SET status = 'online', last_started_at = now(), last_error_code = NULL, updated_at = now() WHERE id = $1", [job.bot_instance_id]);
          } else if (job.job_type === "instance_stop") {
            await client.query("UPDATE bot_instances SET status = 'offline', last_stopped_at = now(), last_error_code = NULL, updated_at = now() WHERE id = $1", [job.bot_instance_id]);
          }
        }
        await client.query("COMMIT");
        return true;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async listBots() {
      const result = await pool.query(
        `SELECT b.id, b.customer_id, c.display_name, c.phone_e164, b.status,
                b.server_id, s.label AS server_label, s.status AS server_status,
                b.release_version, b.last_started_at, b.last_stopped_at, b.last_error_code
           FROM bot_instances b
           JOIN customers c ON c.id = b.customer_id
           LEFT JOIN servers s ON s.id = b.server_id
          ORDER BY b.created_at DESC LIMIT 1000`);
      return result.rows;
    },
    async listInstancesForServer(serverId) {
      const result = await pool.query(
        `SELECT id, status FROM bot_instances
          WHERE server_id = $1 AND status = 'online'
          ORDER BY updated_at DESC LIMIT 500`, [serverId]);
      return result.rows;
    },
    async updateBotStatusForServer({ instanceId, serverId, status, errorCode = null }) {
      if (!["offline", "failed"].includes(status)) return false;
      const result = await pool.query(
        `UPDATE bot_instances SET status = $3, last_error_code = $4,
           last_stopped_at = CASE WHEN $3 = 'offline' THEN now() ELSE last_stopped_at END,
           updated_at = now()
          WHERE id = $1 AND server_id = $2 RETURNING id`,
        [instanceId, serverId, status, errorCode]);
      return result.rowCount === 1;
    },
    async getJobForServer(jobId, serverId) {
      const result = await pool.query(
        `SELECT id, server_id, bot_instance_id, customer_id, job_type, status, payload
           FROM provisioning_jobs WHERE id = $1 AND server_id = $2 LIMIT 1`, [jobId, serverId]);
      return result.rows[0] || null;
    },
    async updatePairingStatus(pairingId, customerId, status, failureCode = null) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (status === "offline") {
          const changed = await client.query(
            `UPDATE bot_instances b SET status = 'offline', last_stopped_at = now(), updated_at = now()
              FROM pairing_requests p
             WHERE p.id = $1 AND p.customer_id = $2 AND p.bot_instance_id = b.id AND p.status = 'paired'
             RETURNING b.id`, [pairingId, customerId]);
          await client.query("COMMIT");
          return changed.rowCount === 1;
        }
        if (!["paired","expired","failed"].includes(status)) { await client.query("ROLLBACK"); return false; }
        const current = await client.query("SELECT status FROM pairing_requests WHERE id = $1 AND customer_id = $2 FOR UPDATE", [pairingId, customerId]);
        if (!current.rowCount) { await client.query("ROLLBACK"); return false; }
        if (status === "paired" && current.rows[0].status === "paired") { await client.query("COMMIT"); return true; }
        const result = await client.query(
          `UPDATE pairing_requests SET status = $3, failure_code = $4,
             paired_at = CASE WHEN $3 = 'paired' THEN now() ELSE paired_at END, updated_at = now()
            WHERE id = $1 AND customer_id = $2 AND status IN ('queued','generating','code_ready')
            RETURNING bot_instance_id`,
          [pairingId, customerId, status, failureCode]);
        if (result.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
        const botId = result.rows[0].bot_instance_id;
        if (status === "paired") {
          const bot = await client.query(
            `UPDATE bot_instances SET status = 'provisioning', last_error_code = NULL, updated_at = now()
              WHERE id = $1 RETURNING server_id`, [botId]);
          if (bot.rows[0]?.server_id) {
            await client.query(
              `INSERT INTO provisioning_jobs (id, server_id, bot_instance_id, customer_id, job_type, payload)
               VALUES ($1, $2, $3, $4, 'instance_start', '{}'::jsonb)`,
              [randomUUID(), bot.rows[0].server_id, botId, customerId]);
          }
        } else {
          await client.query("UPDATE bot_instances SET status = 'offline', last_error_code = $2, updated_at = now() WHERE id = $1", [botId, failureCode || null]);
        }
        await client.query("COMMIT");
        return true;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async markCodeReady(pairingId, customerId) {
      const result = await pool.query(
        `UPDATE pairing_requests SET status = 'code_ready', updated_at = now()
          WHERE id = $1 AND customer_id = $2 AND status = 'generating' RETURNING id`,
        [pairingId, customerId]);
      return result.rowCount === 1;
    }
  };
}
