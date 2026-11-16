# HASA Server Agent Protocol (v1)

## Purpose

The first agent release is telemetry-only. It reports host identity and resource capacity. It cannot install software, execute shell commands, restart services, read customer files or access WhatsApp session data.

## Enrollment

1. Owner signs in to the owner console and creates a one-time enrollment ticket for a specific server label/provider.
2. Ticket expires quickly, is single-use, and is shown only once.
3. Operator installs the signed agent package and supplies the ticket through a protected environment variable or stdin (never command-line arguments).
4. Agent exchanges the ticket over HTTPS for a unique per-server credential.
5. Central API stores only a cryptographic hash of the credential. The agent stores the secret in a root-readable file or OS secret store.
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
