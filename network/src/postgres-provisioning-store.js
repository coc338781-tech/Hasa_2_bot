import { randomUUID } from "node:crypto";

const DEFAULT_MIN_FREE_MEMORY_BYTES = Number(process.env.HASA_MIN_FREE_MEMORY_BYTES || 256 * 1024 * 1024);
if (!Number.isSafeInteger(DEFAULT_MIN_FREE_MEMORY_BYTES) || DEFAULT_MIN_FREE_MEMORY_BYTES < 256 * 1024 * 1024) throw new Error("HASA_MIN_FREE_MEMORY_BYTES must be at least 256 MiB");
async function readMinFreeMemoryBytes(client) {
  const result = await client.query("SELECT setting_value FROM network_settings WHERE setting_key = 'min_free_memory_bytes'");
  const value = result.rows[0]?.setting_value;
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) && bytes >= 256 * 1024 * 1024 ? bytes : DEFAULT_MIN_FREE_MEMORY_BYTES;
}

export function createPostgresProvisioningStore(pool) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") {
    throw new TypeError("A PostgreSQL Pool-compatible object is required");
  }
  return {
    async getMinFreeMemoryBytes() {
      const result = await pool.query("SELECT setting_value FROM network_settings WHERE setting_key = 'min_free_memory_bytes'");
      const bytes = Number(result.rows[0]?.setting_value);
      return Number.isSafeInteger(bytes) && bytes >= 256 * 1024 * 1024 ? bytes : DEFAULT_MIN_FREE_MEMORY_BYTES;
    },
    async setMinFreeMemoryBytes(bytes) {
      if (!Number.isSafeInteger(bytes) || bytes < 256 * 1024 * 1024 || bytes > 64 * 1024 * 1024 * 1024) throw new TypeError("invalid_min_free_memory_bytes");
      await pool.query(
        "INSERT INTO network_settings (setting_key, setting_value, updated_at) VALUES ('min_free_memory_bytes', to_jsonb($1::bigint), now()) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()",
        [bytes]
      );
      await pool.query(
        "INSERT INTO audit_events (action, resource_type, resource_id, outcome, metadata) VALUES ('network.settings.update', 'network_setting', 'min_free_memory_bytes', 'success', jsonb_build_object('value_bytes', $1::bigint))",
        [bytes]
      );
      return bytes;
    },
    async assignBotToAvailableServer({ botId }) {
      const minFreeMemoryBytes = await this.getMinFreeMemoryBytes();
      const candidates = await pool.query(
        `SELECT s.id FROM servers s
          WHERE s.status = 'online'
            AND s.last_heartbeat_at > now() - interval '150 seconds'
            AND s.worker_last_seen_at > now() - interval '90 seconds'
            AND s.memory_available_bytes >= $1
          ORDER BY
            (SELECT count(*) FROM bot_instances b
              WHERE b.server_id = s.id AND b.status IN ('online','provisioning','pairing')) ASC,
            s.memory_available_bytes DESC, s.last_heartbeat_at DESC
          LIMIT 5`,
        [minFreeMemoryBytes]
      );
      let lastReason = null;
      for (const candidate of candidates.rows) {
        const result = await this.assignBotToServer({ botId, serverId: candidate.id });
        if (result.ok) return result;
        lastReason = result.reason;
      }
      return { ok: false, reason: lastReason || "server_unavailable" };
    },
    async assignBotToServer({ botId, serverId }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const server = await client.query(
          `SELECT id, memory_available_bytes, worker_last_seen_at FROM servers
            WHERE id = $1 AND status = 'online'
              AND last_heartbeat_at > now() - interval '150 seconds'
            FOR UPDATE`, [serverId]);
        if (server.rowCount !== 1) { await client.query("ROLLBACK"); return { ok: false, reason: "server_not_online" }; }
        if (!server.rows[0].worker_last_seen_at || Date.now() - new Date(server.rows[0].worker_last_seen_at).getTime() > 90_000) { await client.query("ROLLBACK"); return { ok: false, reason: "worker_not_ready" }; }
        const minFreeMemoryBytes = await readMinFreeMemoryBytes(client);
        if (Number(server.rows[0].memory_available_bytes || 0) < minFreeMemoryBytes) { await client.query("ROLLBACK"); return { ok: false, reason: "server_low_memory" }; }
        const bot = await client.query(
          `UPDATE bot_instances SET server_id = $2, status = 'offline', runtime_provisioned = false, updated_at = now()
            WHERE id = $1 AND status IN ('offline','failed') AND whatsapp_registered = false
            RETURNING id, customer_id, server_id`, [botId, serverId]);
        if (bot.rowCount !== 1) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_not_assignable" }; }
        await client.query(
          `INSERT INTO provisioning_jobs (id, server_id, bot_instance_id, customer_id, job_type, payload)
           VALUES ($1, $2, $3, $4, 'instance_create', '{}'::jsonb)`,
          [randomUUID(), serverId, botId, bot.rows[0].customer_id]);
        await client.query(
          `INSERT INTO audit_events (action, resource_type, resource_id, outcome, metadata)
           VALUES ('bot.assign_server', 'bot_instance', $1, 'success', jsonb_build_object('server_id', $2))`,
          [botId, serverId]);
        await client.query("COMMIT");
        return { ok: true, bot: bot.rows[0] };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async expireStalePairings(customerId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const expired = await client.query(
          `UPDATE pairing_requests SET status = 'expired', failure_code = 'pairing_expired',
             pairing_code_ciphertext = NULL, pairing_code_nonce = NULL, pairing_code_auth_tag = NULL,
             pairing_code_key_version = NULL, updated_at = now()
            WHERE customer_id = $1 AND status IN ('queued','generating','code_ready') AND expires_at <= now()
            RETURNING id, bot_instance_id`, [customerId]);
        if (expired.rowCount) {
          const ids = expired.rows.map(row => row.id);
          const botIds = [...new Set(expired.rows.map(row => row.bot_instance_id))];
          await client.query(
            `UPDATE provisioning_jobs SET status = 'cancelled', completed_at = now(), updated_at = now()
              WHERE job_type = 'pairing_start' AND status IN ('queued','leased','running')
                AND payload->>'pairing_request_id' = ANY($1::text[])`, [ids]);
          await client.query(
            `UPDATE bot_instances SET status = 'offline', last_error_code = 'pairing_expired', updated_at = now()
              WHERE id = ANY($1::uuid[]) AND status = 'pairing'`, [botIds]);
        }
        await client.query("COMMIT");
        return expired.rowCount;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async enqueuePairing({ customerId, botId, phone, expiresAt }) {
      const client = await pool.connect();
      const pairingId = randomUUID(), jobId = randomUUID();
      try {
        await client.query("BEGIN");
        const owned = await client.query(
          `SELECT b.id, b.server_id, b.status AS bot_status, b.whatsapp_registered, b.runtime_provisioned, s.status AS server_status, s.last_heartbeat_at, s.worker_last_seen_at, s.memory_available_bytes
             FROM bot_instances b LEFT JOIN servers s ON s.id = b.server_id
            WHERE (b.id::text = $1 OR b.public_id = $1)
              AND ($2::uuid IS NULL OR b.customer_id = $2) FOR UPDATE OF b`, [botId, customerId]);
        if (owned.rowCount !== 1) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_not_found" }; }
        const server = owned.rows[0];
        if (!["offline", "failed"].includes(server.bot_status)) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_not_ready" }; }
        if (server.whatsapp_registered) { await client.query("ROLLBACK"); return { ok: false, reason: "already_paired" }; }
        if (!server.runtime_provisioned) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_not_ready" }; }
        if (!server.server_id || server.server_status !== "online" ||
            !server.last_heartbeat_at || Date.now() - new Date(server.last_heartbeat_at).getTime() > 150_000) {
          await client.query("ROLLBACK"); return { ok: false, reason: "server_unavailable" };
        }
        if (!server.worker_last_seen_at || Date.now() - new Date(server.worker_last_seen_at).getTime() > 90_000) { await client.query("ROLLBACK"); return { ok: false, reason: "worker_not_ready" }; }
        const minFreeMemoryBytes = await readMinFreeMemoryBytes(client);
        if (Number(server.memory_available_bytes || 0) < minFreeMemoryBytes) {
          await client.query("ROLLBACK"); return { ok: false, reason: "server_low_memory" };
        }
        await client.query(
          `UPDATE pairing_requests SET status = 'cancelled', pairing_code_ciphertext = NULL, pairing_code_nonce = NULL,
             pairing_code_auth_tag = NULL, pairing_code_key_version = NULL, updated_at = now()
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
          [jobId, server.server_id, botId, customerId, JSON.stringify({ pairing_request_id: pairingId })]);
        await client.query("UPDATE bot_instances SET status = 'pairing', updated_at = now() WHERE id = $1", [botId]);
        await client.query("COMMIT");
        return { ok: true, request: { id: pairingId, status: "queued", phone_e164: phone, expires_at: expiresAt } };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async claimNextJob(serverId, leaseSeconds = 90, allowedTypes = ["instance_create","pairing_start","instance_start","instance_stop","instance_restart"], activeInstanceIds = []) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `WITH candidate AS (
             SELECT j.id, p.phone_e164, b.public_id AS public_bot_id FROM provisioning_jobs j
             LEFT JOIN pairing_requests p ON p.id::text = j.payload->>'pairing_request_id'
             LEFT JOIN bot_instances b ON b.id = j.bot_instance_id
              WHERE j.server_id = $1 AND j.job_type = ANY($3::text[])
                AND ((j.status = 'queued' AND j.available_at <= now())
                  OR (j.status = 'leased' AND j.lease_expires_at < now()))
                AND j.attempts < 5
                AND (j.job_type <> 'instance_restart' OR j.bot_instance_id = ANY($4::uuid[]))
              ORDER BY j.created_at
              FOR UPDATE OF j SKIP LOCKED LIMIT 1
           ), leased AS (
             UPDATE provisioning_jobs j
                SET status = 'leased', attempts = attempts + 1,
                    lease_expires_at = now() + ($2 * interval '1 second'), updated_at = now()
               FROM candidate c WHERE j.id = c.id
             RETURNING j.id, j.bot_instance_id, j.customer_id, j.job_type, j.payload, j.attempts
           )
           SELECT leased.*, candidate.phone_e164, candidate.public_bot_id FROM leased
           JOIN candidate ON candidate.id = leased.id`,
          [serverId, leaseSeconds, allowedTypes, activeInstanceIds]);
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
          `SELECT bot_instance_id, customer_id, job_type, payload, status
             FROM provisioning_jobs WHERE id = $1 AND server_id = $2 FOR UPDATE`, [jobId, serverId]);
        if (!found.rowCount || !["running", "leased"].includes(found.rows[0].status)) { await client.query("ROLLBACK"); return false; }
        const job = found.rows[0];
        await client.query(
          `UPDATE provisioning_jobs SET status = $2, result = $3::jsonb, updated_at = now(),
             completed_at = now(), lease_expires_at = NULL WHERE id = $1 AND server_id = $4`,
          [jobId, status, result ? JSON.stringify(result) : null, serverId]);
        if (status === "failed") {
          await client.query(
            `UPDATE bot_instances SET status = 'failed', runtime_provisioned = CASE WHEN $3 = 'instance_create' THEN false ELSE runtime_provisioned END, last_error_code = $2,
               whatsapp_registered = CASE WHEN $2 IN ('whatsapp_session_not_registered','whatsapp_session_invalid') THEN false ELSE whatsapp_registered END,
               updated_at = now() WHERE id = $1`, [job.bot_instance_id, errorCode || "worker_failed", job.job_type]);
          if (job.job_type === "pairing_start") {
            await client.query(
              `UPDATE pairing_requests SET status = 'failed', failure_code = $2, updated_at = now()
                WHERE id = $1 AND status IN ('queued','generating')`,
              [job.payload.pairing_request_id, errorCode || "worker_failed"]);
          }
        } else if (status === "succeeded") {
          if (job.job_type === "instance_create") {
            await client.query("UPDATE bot_instances SET status = 'offline', runtime_provisioned = true, last_error_code = NULL, updated_at = now() WHERE id = $1", [job.bot_instance_id]);
          } else if (job.job_type === "instance_start" || job.job_type === "instance_restart") {
            await client.query("UPDATE bot_instances SET status = 'provisioning', last_started_at = now(), last_error_code = NULL, updated_at = now() WHERE id = $1", [job.bot_instance_id]);
          } else if (job.job_type === "instance_stop") {
            await client.query("UPDATE bot_instances SET status = 'offline', last_stopped_at = now(), last_error_code = NULL, updated_at = now() WHERE id = $1", [job.bot_instance_id]);
          }
        }
        await client.query("COMMIT");
        return true;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async queueBotAction({ customerId = null, botId, action }) {
      const jobType = ({ start: "instance_start", stop: "instance_stop", restart: "instance_restart" })[action];
      if (!jobType) return { ok: false, reason: "invalid_action" };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const found = await client.query(
          `SELECT b.id, b.server_id, b.status AS bot_status, b.whatsapp_registered, b.runtime_provisioned, s.status AS server_status,
                  s.last_heartbeat_at, s.worker_last_seen_at, s.memory_available_bytes
             FROM bot_instances b LEFT JOIN servers s ON s.id = b.server_id
            WHERE (b.id::text = $1 OR b.public_id = $1)
              AND ($2::uuid IS NULL OR b.customer_id = $2) FOR UPDATE OF b`, [botId, customerId]);
        if (!found.rowCount) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_not_found" }; }
        const bot = found.rows[0];
        if (!bot.server_id || bot.server_status !== "online" || !bot.last_heartbeat_at ||
            Date.now() - new Date(bot.last_heartbeat_at).getTime() > 150_000) {
          await client.query("ROLLBACK"); return { ok: false, reason: "server_unavailable" };
        }
        if (!bot.worker_last_seen_at || Date.now() - new Date(bot.worker_last_seen_at).getTime() > 90_000) { await client.query("ROLLBACK"); return { ok: false, reason: "worker_not_ready" }; }
        const allowed = action === "start" ? ["offline", "failed"] : action === "stop" ? ["online", "provisioning"] : ["online"];
        if (!allowed.includes(bot.bot_status)) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_action_not_allowed" }; }
        if (!bot.runtime_provisioned) { await client.query("ROLLBACK"); return { ok: false, reason: "bot_not_ready" }; }
        if (action !== "stop" && !bot.whatsapp_registered) { await client.query("ROLLBACK"); return { ok: false, reason: "pairing_required" }; }
        const minFreeMemoryBytes = await readMinFreeMemoryBytes(client);
        if (action !== "stop" && Number(bot.memory_available_bytes || 0) < minFreeMemoryBytes) {
          await client.query("ROLLBACK"); return { ok: false, reason: "server_low_memory" };
        }
        const active = await client.query(
          `SELECT 1 FROM provisioning_jobs WHERE bot_instance_id = $1
      "‹­¦ëm®éÜj×