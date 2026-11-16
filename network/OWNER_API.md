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

A successful login returns a signed bearer session valid for 30 minutes. Keep it in the trusted owner console's memory; do not place it in URLs, browser local storage, logs, or screenshots.

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

This is a backend API foundation, not a finished owner web dashboard. A PostgreSQL runtime connection is enabled with `DATABASE_URL`; run `npm run db:migrate` from this directory to apply the initial schema. `/readyz` reports whether a persistent store is configured. The owner UI, secure agent-side token installation, TLS proxy deployment and live enrollment are not yet wired together. Without a configured persistent store, management endpoints fail closed. Do not deploy this API publicly until HTTPS and the deployment secret are configured.

The platform owner retains the credentials and final authority. An assistant can help maintain the code and perform actions only through tools and permissions explicitly made available by the owner; it does not receive permanent independent access to servers.
