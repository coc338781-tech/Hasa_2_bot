# HASA BOT NETWORK — Security Boundaries

## Ownership and access

- Exactly one platform owner has infrastructure-administrator permissions.
- The current bootstrap API uses `HASA_OWNER_ACCESS_KEY` (minimum 32 characters) supplied only through the deployment secret manager/environment; never commit it or paste it into chat.
- Owner login is rate-limited and returns a signed bearer session valid for 30 minutes. Enrollment-ticket creation requires that session. If the key is absent or too short, owner login is disabled.
- The owner API is served through a browser dashboard at `/owner`; its session token remains in tab memory only. Keep the control plane behind HTTPS. Deploy it only behind HTTPS and a trusted reverse proxy; keep the API bound to localhost until that is configured.
- Customer accounts are tenant-scoped and cannot enumerate other customers, bot IDs, phone numbers, sessions, logs or servers.
- Server agents have unique revocable identities and least-privilege permissions.
- The agent cannot run arbitrary shell commands. It accepts typed operations from a strict allow-list.
- Secrets are never stored in source control or emitted in logs.

## WhatsApp pairing and sessions

- Pairing requests are short-lived, single-use and bound to the initiating browser session and normalized phone number.
- Apply rate limits, abuse detection and a cooldown after failed attempts.
- Do not reveal whether a number belongs to an existing customer.
- Pairing codes must be redacted from logs and deleted after completion or expiry.
- Store each customer's Baileys credentials in a separate encrypted record and filesystem boundary.
- Restrict session file permissions; use encryption at rest with keys held outside the database and source repository.
- Never expose raw session credentials in the customer panel, admin reports, chat responses or GitHub artifacts.
- Provide a customer unlink/deletion workflow and explain that WhatsApp multi-device linking can be revoked by the account owner.

## Server agent

- Prefer outbound-only connections; do not expose an SSH daemon or agent control port publicly for this platform.
- Authenticate every agent using a unique certificate/token that can be revoked independently.
- Use signed, expiring jobs with replay protection.
- Allow only specific operations such as heartbeat, resource report, install approved release, start/stop a named instance and collect redacted health status.
- Never allow the agent to read unrelated home directories, SSH keys, environment files or other tenants' session folders.
- Separate host telemetry from tenant message content. The platform does not need to collect customer chats to monitor server health.

## Releases and operations

- Build immutable, versioned artifacts and verify checksums/signatures before installation.
- Test in staging and canary before global rollout.
- Back up instance metadata and preserve encrypted sessions before updates.
- Enforce a single active process per bot ID/session.
- Keep an append-only audit record of owner actions.
- Do not auto-restart, redeploy, migrate or delete a production bot as a side effect of a read-only monitoring request.

## Privacy and compliance

Before offering hosting commercially, document customer consent, data retention, account unlinking, incident response, acceptable use and the applicable WhatsApp terms. The platform should use supported WhatsApp integration methods and must not promise uninterrupted availability or immunity from account restrictions.
