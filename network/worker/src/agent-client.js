export function createAgentWorkerClient({ apiUrl, token, fetchImpl = fetch, timeoutMs = 15_000 } = {}) {
  if (typeof apiUrl !== "string" || typeof token !== "string" || token.length < 32) throw new TypeError("worker_agent_api_credentials_required");
  const base = new URL(apiUrl);
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(base.hostname)) {
    throw new TypeError("worker_agent_api_requires_https");
  }
  async function request(path, body = {}) {
    const response = await fetchImpl(new URL(path, base), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `agent_api_http_${response.status}`);
      error.status = response.status;
      error.code = data.error || "agent_api_error";
      throw error;
    }
    return data;
  }
  return Object.freeze({
    async claimNextJob() {
      const result = await request("/v1/agent/jobs/claim");
      return result.job || null;
    },
    async finishJob(jobId, { status, result = null, errorCode = null } = {}) {
      return request("/v1/agent/jobs/finish", { job_id: jobId, status, result, error_code: errorCode });
    },
    async submitPairingCode({ jobId, code, expiresAt }) {
      return request("/v1/agent/pairing-code", { job_id: jobId, code, expires_at: expiresAt });
    },
    async updatePairingStatus({ jobId, status, failureCode = null }) {
      return request("/v1/agent/pairing-status", { job_id: jobId, status, failure_code: failureCode });
    },
    async listInstances() {
      const result = await request("/v1/agent/instances/list");
      return result.instances || [];
    },
    async reportInstanceStatus({ instanceId, status, errorCode = null }) {
      return request("/v1/agent/instances/status", { instance_id: instanceId, status, error_code: errorCode });
    }
  });
}
