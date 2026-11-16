# HASA BOT NETWORK — Security Boundaries

## Ownership and access

- Exactly one platform owner has infrastructure-administrator permissions.
- The current bootstrap API uses `HASA_OWNER_ACCESS_KEY` (minimum 32 characters) supplied only through the deployment secret manager/environment; never commit it or paste it into chat.
- Owner login is rate-limited and returns a signed bearer session valid for 30 minutes. Enrollment-ticket creation requires that session. If the key is absent or too short, owner login is disabled.
- The owner API is served through a browser dashboard at `/owner`; its session token remains in tab memory only. Keep the control plane behind HTTPS. Deploy it only behind HTTPS and a trusted reverse proxy; keep the API bound to localhost until that is configured.
- Customer accounts are tenant-scoped and cannot enumerate other customers, bot IDs, phone numbers, sessions, logs or servers.
- Server telemetry agents have unique revocable identities and report host metrics only.
- The separate worker service uses the enrolled server token over HTTPS and can claim only typed allow-listed jobs for that server. It cannot run arbitrary shell commands.
- Secrets are never stored in source control or emitted in logs.

## Website design and role boundaries

- Website branding, themes, layout, pages, menus, navigation and global settings are editable by the single platform owner only.
- Customers receive no website-editor or repository/deployment access. They may manage only their own bot using explicitly allowed customer actions.
- Enforce owner/customer separation on every API request using server-side session identity and tenant scoping. Never trust role or customer identifiers from browser payloads.
- Owner design-management routes must reject customer sessions even if a customer manually calls the endpoint. Unknown roles and unavailable auth stores fail closed.
- Audit all owner design and global-setting changes without recording secrets. See [OWNER_DESIGN_POLICY.md](./OWNER_DESIGN_POLICY.md).

## WhatsApp pairing and sessions

- Pairing requests are short-lived, single-use and bound to the initiating browser session and normalized phone number.
- Apply rate limits, abuse detection and a cooldown after failed attempts.
- Do not reveal whether a number belongs to an existing customer.
- Pairing codes must be redacted from logs and deleted after completion or expiry.
- Store each customer's Baileys auth files in a separate per-instance directory on a dedicated encrypted filesystem volume. Directory permissions alone are not encryption.
- Keep the volume encryption key outside the volume and source repository. The database AES-256-GCM vault is currently used for short-lived pairing codes; the `whatsapp_session_vault` table is not yet the active auth-file adapter.
- Never expose raw session credentials in the customer panel, admin reports, chat responses or GitHub artifacts.
- Provide a customer unlink/deletion workflow and explain that WhatsApp multi-device linking can be revoked by the account owner.

## Telemetry agent and isolated worker

- Prefer outbound-only connections; do not expose an SSH daemon or agent control port publicly for this platform.
- Authenticate each server with a unique revocable token stored in a root-managed file.
- The telemetry agent reports host metrics only and cannot read customer session files or process environments.
- The separate worker accepts only typed job operations through the central HTTPS API; no generic shell or arbitrary file-path command exists.
- Every job is bound to its registered server ID, leased, and checked against current server heartbeat and RAM admission rules.
- The worker runs as a dedicated unprivileged system user, with write access restricted to the encrypted instance volume and a memory limit.
- Bot child processes receive a minimal environment; the server agent token and central pairing encryption key are not inherited by customer bot processes.
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
