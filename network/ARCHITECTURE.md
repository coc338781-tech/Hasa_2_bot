# HASA BOT NETWORK — Architecture

## 1. Topology

```
Customer Browser
      |
      v
Pairing Portal ---- Central API ---- Owner Console
                       |
          +------------+-------------+
          |            |             |
       Database  Pairing Code Vault  Release Registry
          |
     Scheduler / Capacity Allocator
          |
    Authenticated outbound agent + worker channel
          |
   +------+------+------+
   |             |      |
Linux Node 1  Oracle 1  Linux Node N
   |             |      |
Telemetry agent + isolated worker
   |
HASA instance per customer number (isolated)
```

The control plane is central; bot workloads are distributed across registered Linux servers. The control plane must not require inbound SSH access from the public internet. Telemetry agents report over outbound HTTPS; the separate worker polls the central API and claims only server-bound allow-listed jobs.

## 2. Identity model

- `customer_id`: internal customer identity.
- `bot_id`: platform-generated stable ID for one WhatsApp number / bot instance.
- `server_id`: platform identity for a registered host.
- `release_id`: immutable version of the shared HASA BOT release.
- `session_ref`: opaque reference to a per-instance directory on an encrypted filesystem; never the credentials themselves.

A customer account has one normalized contact number; the WhatsApp number linked to its bot is separately selected during pairing. Phone numbers are personal data and logs should avoid or mask them.

## 3. Pairing lifecycle

1. Customer submits their number over HTTPS.
2. Central API validates format, applies per-IP and per-number rate limits, and creates a short-lived pairing request.
3. The platform owner assigns the bot to a healthy registered server. Assignment requires a fresh heartbeat and the configured free-RAM reserve.
4. The assigned server worker claims the pairing job over its authenticated HTTPS channel. It asks Baileys for the phone-number pairing code only when the socket is ready.
5. Portal polls an authenticated request state and displays the code only to the browser session that initiated it.
6. Customer enters the code in WhatsApp Linked Devices.
7. The API encrypts the short-lived pairing code with AES-256-GCM for one-time customer retrieval; it is never stored in plaintext.
8. On successful registration, the worker saves Baileys auth files under the instance directory on the server's dedicated encrypted filesystem volume.
9. The temporary pairing socket closes and the worker starts the shared HASA BOT code as a separate process with that instance directory as its working directory.
10. The customer sees the bot ID and health status. Pairing code ciphertext is cleared on retrieval, completion or expiry.

Pairing codes are short-lived secrets. Never place them in URLs, analytics, logs, GitHub issues, or shared server reports. A code is displayed in the website; it is not assumed to arrive as an SMS.

## 4. Server scheduling

Capacity is based on measured available memory, CPU load, disk headroom, configured safety reserve and current instance count. Never schedule from total RAM alone. Keep a per-host reserve for OS, agent, control-plane processes and spikes. Do not automatically migrate a live WhatsApp session until a tested, encrypted transfer and single-writer handoff protocol exists.

## 5. Updates

- Build one immutable release artifact from the shared source.
- Run automated tests and a staging instance first.
- Deploy to a small canary group.
- Verify process health, WhatsApp connection state and error rates.
- Continue in batches only when checks pass.
- Preserve each instance's data and credentials outside the replaceable release directory.
- Keep the previous known-good release and provide automatic rollback.
- Customer `.update` requests only enqueue an update for that customer's instance; owner approval and release policy remain authoritative.
- Owner global deployment can target all instances, but must be staged and auditable.

## 6. Availability and recovery

A server heartbeat timeout marks a host unavailable; it does not imply its WhatsApp sessions can safely be started elsewhere. The control plane should report the failure, retain the last known state and require a controlled recovery workflow. Prevent two processes from using the same WhatsApp session concurrently.

## 7. Initial technology direction

- Node.js 22 LTS for API and agent, matching the existing bot runtime baseline.
- PostgreSQL for customer, server, instance, release and audit metadata.
- Redis or a durable queue for jobs and pairing state.
- HTTPS for portal/API; outbound mTLS or per-agent certificates for agent communication.
- Dedicated encrypted filesystem per worker server for Baileys auth files; AES-256-GCM PostgreSQL vault for short-lived pairing codes.
- systemd or a tightly managed process supervisor for agent and bot workloads.

Technology choices are provisional until the first deployable vertical slice is tested on a spare server.
