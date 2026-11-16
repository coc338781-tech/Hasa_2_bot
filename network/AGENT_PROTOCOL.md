# HASA Server Agent Protocol (v1)

## Purpose

The agent is telemetry-only. It reports host identity and resource capacity over outbound HTTPS. It cannot install software, execute shell commands, restart services, read customer files or access WhatsApp session data.

## Enrollment

1. The owner-controlled provisioning layer creates a cryptographically random ticket for a specific server label/provider. The owner issues the ticket through the authenticated owner API; never expose ticket creation through an unauthenticated endpoint.
2. Store only the SHA-256 ticket hash in `server_enrollment_tickets`; ticket expiry and single-use consumption are enforced transactionally. The raw ticket is shown only once.
3. Operator installs the signed agent package and supplies the ticket through a protected environment variable or stdin (never command-line arguments).
4. Agent exchanges the ticket with `POST /v1/agent/enroll` over HTTPS for a unique per-server credential. The endpoint is rate-limited and returns the credential only in the successful one-time response.
5. Central API stores only a SHA-256 hash of the credential. The agent must store the secret in a root-readable file or OS secret store. The agent exchanges the ticket automatically and stores its unique token in a configurable local file with restrictive permissions (default `~/.config/hasa-agent/credentials.json`, mode `0600`).
6. Owner can revoke that server credential at any time.

Enrollment tickets and agent credentials must never be placed in Git, shell history, logs, issue comments or chat reports.

## Heartbeat

Agent sends an authenticated HTTPS POST to `/v1/agent/heartbeat` at a configurable interval. Payload contains:
- server_id
- agent_version
- hostname
- OS name/release and architecture
- CPU core count and load averages
- total and available memory in bytes
- total and available disk bytes for the configured data path
- timestamp and a unique request ID

The API verifies the credential, validates payload bounds and timestamp, rejects replayed request IDs, updates the server row and returns a minimal acknowledgement. It does not return arbitrary commands.

## Security requirements

- HTTPS is mandatory outside local development.
- Unique credentials per server; constant-time token verification where applicable; hash at rest; revocation supported.
- Rate limit enrollment and heartbeat routes.
- Agent uses an outbound connection only.
- No remote shell, arbitrary command execution, file browsing, session access or bot control in telemetry-only phase.
- Hostname and labels are untrusted display data; escape them in dashboards.
- Heartbeat data must not include IP credentials, environment variables, process command lines, customer message content or WhatsApp session data.

## Future command channel

A later phase may add a signed, expiring, replay-protected job queue with a strict typed allow-list (for example, deploy approved immutable release to bot_id). Each job requires owner authorization and audit logging. Never add a generic `exec` or shell command operation.

## Agent configuration

Set `HASA_AGENT_API_URL` to the central API HTTPS origin. On first start, provide the one-time `HASA_AGENT_ENROLLMENT_TICKET`; after successful enrollment the agent saves its credential locally and subsequent starts reuse it. Optional settings are `HASA_AGENT_TOKEN_FILE`, `HASA_AGENT_DATA_PATH` (defaults to `/`), and `HASA_AGENT_INTERVAL_SECONDS` (defaults to 60). HTTP is accepted only for localhost development. Never pass tickets or tokens as command-line arguments.
