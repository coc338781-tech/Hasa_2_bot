# Owner API (development)

The owner API is restricted to the platform owner. It is not a customer API.

## Bootstrap

Set `HASA_OWNER_ACCESS_KEY` in the deployment secret manager. It must contain at least 32 characters and must never be committed, logged, or pasted into chat. Keep the API bound to localhost behind a trusted HTTPS reverse proxy. Do not expose it publicly over plain HTTP.

Login:

```http
POST /v1/owner/login
Content-Type: application/json

{"access_key":"<deployment-secret>"}
```

A successful login returns a signed bearer session valid for 30 minutes. Open `/owner` to use the browser console; it keeps the session only in tab memory and never writes it to browser storage. Do not place it in URLs, logs, or screenshots.

## Owner operations

All routes below require:

```http
Authorization: Bearer <owner-session>
```

- `GET /v1/owner/servers` — list up to 500 registered servers and their latest telemetry.
- `GET /v1/owner/settings` — read the current minimum free RAM reserve.
- `PUT /v1/owner/settings` — change `min_free_memory_mb` (128–65536 MiB). Default: 768 MiB. This is a free-RAM admission threshold, not total server RAM or a bot memory quota. Existing bots are not stopped when available RAM falls below it.
- `GET /v1/owner/bots` — list customer bot instances for owner-side allocation.
- `POST /v1/owner/bots/{bot_id}/assign-server` — assign a bot to an online server. JSON body: `{"server_id":"<registered-server-uuid>"}`. Assignment is audited and rejects offline/stale servers.
- `POST /v1/owner/server-enrollment-tickets` — create a one-use enrollment ticket valid for 10 minutes. JSON body: `{"label":"Oracle primary","provider":"Oracle Cloud"}`. The raw ticket is returned once.
- `POST /v1/owner/servers/{server_id}/revoke` — disable a server and revoke its agent credential. This action is audited.

The server agent uses `POST /v1/agent/enroll` with the one-time ticket, then sends authenticated heartbeats to `POST /v1/agent/heartbeat`. The isolated worker reads the current RAM reserve from `POST /v1/agent/settings` and uses that same server agent token over HTTPS for `POST /v1/agent/jobs/claim`, `/v1/agent/jobs/finish`, `/v1/agent/pairing-code`, `/v1/agent/pairing-status`, `/v1/agent/instances/list` and `/v1/agent/instances/status`. Every job and instance is bound to the enrolled server identity; workers cannot request arbitrary commands.

## Current limitations

The owner dashboard is available at `/owner`. A PostgreSQL runtime connection is enabled with `DATABASE_URL`; run `npm run db:migrate` from this directory to apply all numbered migrations. `/readyz` requires the persistent stores and encrypted pairing-code vault to be configured. The owner UI supports server inventory, live telemetry, one-time enrollment tickets, credential revocation, customer bot inventory, server assignment and owner-editable minimum free RAM admission policy. TLS reverse-proxy deployment, release manager/rollback, production backups, customer quotas and live end-to-end validation remain outstanding. Without configured persistent storage and the pairing-code key, management and worker endpoints fail closed. Do not deploy this API publicly until HTTPS and deployment secrets are configured.

The platform owner retains the credentials and final authority. An assistant can help maintain the code and perform actions only through tools and permissions explicitly made available by the owner; it does not receive permanent independent access to servers.


## Customer workspace (development)

The customer workspace is served at `/customer`. Public registration accepts an email, an international E.164 WhatsApp number and a password of at least 12 characters. Passwords are stored as salted scrypt hashes. Customer bearer tokens are random, stored only as SHA-256 hashes in PostgreSQL, and expire after seven days. The browser keeps the token in tab memory only.

- `POST /v1/customer/register` — create a customer, a separate bot-instance record and a customer session.
- `POST /v1/customer/login` — authenticate a customer and issue a session.
- `GET /v1/customer/me` — return only the authenticated customer's account, bot and latest pairing request.
- `POST /v1/customer/logout` — revoke the current session.
- `POST /v1/customer/pairing-requests` — enqueue a pairing request for the authenticated customer's own bot only.
- `GET /v1/customer/pairing-requests/{pairing_id}/code` — consume the short-lived pairing code once, only for the authenticated customer's latest request.
- `POST /v1/customer/bots/{bot_id}/actions` — queue `start`, `stop` or `restart` for the authenticated customer's own bot. Server RAM and server ownership are checked.

Customer endpoints fail closed if PostgreSQL is not configured. Login and registration are rate-limited. Customer account and bot lookups are scoped by the authenticated customer ID; no customer-supplied customer ID is trusted.

**Pairing status:** the Baileys worker, HTTPS job handoff, AES-256-GCM one-time pairing-code vault and isolated per-customer bot process launcher are implemented on the development branch. The worker stores Baileys auth files only on the dedicated encrypted session volume. The dashboard does not fabricate codes. This flow has not yet been verified against a real WhatsApp account on an isolated enrolled server, so do not advertise it as production-live.


## Real pairing-code delivery

Set `HASA_PAIRING_CODE_KEY` on the central API to a base64-encoded 32-byte key (generate a new key with `openssl rand -base64 32`). Apply migrations with `npm run db:migrate`. The key must remain in the central deployment secret manager and must be backed up securely; it is not stored in PostgreSQL or copied to worker servers.

The API encrypts pairing codes using AES-256-GCM before database storage. The customer endpoint `GET /v1/customer/pairing-requests/{pairing_id}/code` checks the authenticated customer's latest pairing request and consumes the code once. It does not accept a customer ID from the browser.

Install a worker only on an enrolled server after mounting an encrypted filesystem at `/var/lib/hasa-worker/sessions`. Follow [the worker installation guide](./worker/README.md). Do not enable it on production until HTTPS, the database, the encryption key and server resource limits are configured and the actual WhatsApp pairing flow has been tested.

## Current deployment status

All of these changes are development-branch code only. No production API, PostgreSQL instance, encrypted volume, server worker, or WhatsApp customer session has been deployed. The pairing code implementation is not yet verified against a live WhatsApp account. The worker now provisions isolated customer working directories and starts the shared HASA bot plugin runtime as a separate process, with customer-scoped start/stop/restart controls and worker-restart recovery. These lifecycle paths still need integration tests on an isolated enrolled server.
