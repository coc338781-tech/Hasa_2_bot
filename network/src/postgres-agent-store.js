// PostgreSQL adapter. Pass an already-configured pg Pool; this module never reads credentials itself.
export function createPostgresAgentStore(pool) {
  if (!pool || typeof pool.query !== "function" || typeof pool.connect !== "function") throw new TypeError("A PostgreSQL Pool-compatible object is required");
  return {
    async consumeEnrollmentTicket({ ticketHash, serverId, tokenHash, now }) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const claimed = await client.query(
          `UPDATE server_enrollment_tickets SET consumed_at = $2
            WHERE ticket_hash = $1 AND consumed_at IS NULL AND expires_at > $2
            RETURNING label, provider`,
          [ticketHash, new Date(now).toISOString()]
        );
        if (claimed.rowCount !== 1) { await client.query("ROLLBACK"); return null; }
        const { label, provider } = claimed.rows[0];
        await client.query(`INSERT INTO servers (id, label, provider, hostname, status) VALUES ($1, $2, $3, 'pending-enrollment', 'pending')`, [serverId, label, provider]);
        await client.query(`INSERT INTO server_agent_credentials (server_id, token_hash) VALUES ($1, $2)`, [serverId, tokenHash]);
        await client.query("COMMIT");
        return { label, provider };
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
    async findActiveServerByTokenHash(tokenHash) {
      const result = await pool.query(
        `SELECT s.id, c.token_hash FROM servers s JOIN server_agent_credentials c ON c.server_id = s.id
          WHERE c.token_hash = $1 AND c.revoked_at IS NULL AND s.status <> 'disabled' LIMIT 1`, [tokenHash]);
      return result.rows[0] || null;
    },
    async recordHeartbeat(serverId, payload, now) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const replay = await client.query(
          `INSERT INTO server_heartbeat_requests (server_id, request_id, observed_at)
           VALUES ($1, $2, $3) ON CONFLICT (server_id, request_id) DO NOTHING RETURNING request_id`,
          [serverId, payload.request_id, payload.observed_at]);
        if (replay.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
        await client.query(
          `UPDATE servers SET hostname = $2, os_name = $3, os_release = $4, architecture = $5,
             agent_version = $6, cpu_cores = $7, memory_total_bytes = $8, memory_available_bytes = $9,
             disk_total_bytes = $10, disk_available_bytes = $11, last_heartbeat_at = $12,
             status = 'online', updated_at = $12 WHERE id = $1`,
          [serverId, payload.hostname, payload.os_name, payload.os_release, payload.architecture,
           payload.agent_version, payload.cpu_cores, payload.memory_total_bytes, payload.memory_available_bytes,
           payload.disk_total_bytes, payload.disk_available_bytes, new Date(now).toISOString()]);
        await client.query("COMMIT");
        return true;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
  };
}
