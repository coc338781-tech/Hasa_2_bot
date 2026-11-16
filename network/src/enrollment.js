import { createHash, randomBytes, randomUUID } from "node:crypto";

export const hashSecret = value => createHash("sha256").update(value, "utf8").digest("hex");

export async function exchangeEnrollmentTicket({ ticket, store, now = Date.now() }) {
  if (typeof ticket !== "string" || ticket.length < 32 || ticket.length > 256) {
    return { status: 400, error: "invalid_enrollment_ticket" };
  }
  if (!store || typeof store.consumeEnrollmentTicket !== "function") {
    return { status: 503, error: "enrollment_storage_unavailable" };
  }
  const serverId = randomUUID();
  const agentToken = randomBytes(32).toString("base64url");
  const result = await store.consumeEnrollmentTicket({
    ticketHash: hashSecret(ticket),
    serverId,
    tokenHash: hashSecret(agentToken),
    now
  });
  if (!result) return { status: 401, error: "invalid_or_expired_ticket" };
  return {
    status: 200,
    body: { server_id: serverId, agent_token: agentToken, server_label: result.label, provider: result.provider }
  };
}
