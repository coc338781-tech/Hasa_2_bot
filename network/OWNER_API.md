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
- `POST /v1/owner/server-enrollment-tickets` — create a one-use enrollment ticket valid for 10 minutes. JSON body: `{"label":"Oracle primary","provider":"Oracle Cloud"}`. The raw ticket is returned once.
- `POST /v1/owner/servers/{server_id}/revoke` — disable a server and revoke its agent credential. This action is audited.

The server agent uses `POST /v1/agent/enroll` with the one-time ticket, then sends authenticated heartbeats to `POST /v1/agent/heartbeat`.

## Current limitations

The owner dashboard is available at `/owner`. A PostgreSQL runtime connection is enabled with `DATABASE_URL`; run `npm run db:migrate` from this directory to apply the initial schema. `/readyz` reports whether a persistent store is configured. The owner UI supports server inventory, live telemetry refresh, one-time enrollment ticket creation and credential revocation. The agent supports one-time enrollment and heartbeat reporting. TLS proxy deployment, customer pairing portal, isolated bot provisioning, encrypted session vault and release manager are not yet implemented. Without a configured persistent store, management endpoints fail closed. Do not deploy this API publicly until HTTPS and the deployment secret are configured.

The platform owner retains the credentials and final authority. An assistant can help maintain the code and perform actions only through tools and permissions explicitly made available by the owner; it does not receive permanent independent access to servers.


## Customer workspace (development)

The customer workspace is served at `/customer`. Public registration accepts an email, an international E.164 WhatsApp number and a password of at least 12 characters. Passwords are stored as salted scrypt hashes. Customer bearer tokens are random, stored only as SHA-256 hashes in PostgreSQL, and expire after seven days. The browser keeps the token in tab memory only.

- `POST /v1/customer/register` — create a customer, a separate bot-instance record and a customer session.
- `POST /v1/customer/login` — authenticate a customer and issue a session.
- `GET /v1/customer/me` — return only the authenticated customer's account, bot and latest pairing request.
- `POST /v1/customer/logout` — revoke the current session.
- `POST /v1/customer/pairing-requests` — enqueue a pairing request for the authenticated customer's own bot only.

Customer endpoints fail closed if PostgreSQL is not configured. Login and registration are rate-limited. Customer account and bot lookups are scoped by the authenticated customer ID; no customer-supplied customer ID is trusted.

**Pairing limitation:** request intake is implemented, but the Baileys worker that creates a real WhatsApp pairing code and persists encrypted auth state is not yet connected. The dashboard intentionally never fabricates a pairing code. The request remains queued until the worker and a server runtime are implemented. Do not advertise pairing as live yet.
