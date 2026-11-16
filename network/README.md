# HASA BOT NETWORK

A separate multi-server hosting and management platform for the single shared HASA BOT product.

## Non-negotiable design rules

- All customers receive the same HASA BOT codebase and feature set.
- Each linked WhatsApp number gets its own isolated bot instance, credentials, data directory, configuration and process identity.
- The owner is the only person allowed to register servers, deploy releases, start/stop instances, change platform settings or access infrastructure controls.
- Customers may request and manage only their own permitted bot actions (for example, view status and request an update).
- The existing production Hasa_2_bot deployment and its WhatsApp session are not modified by this platform project.
- No WhatsApp credentials, pairing codes, API keys, SSH keys or server registration secrets are committed to Git.

## Platform components

1. **Pairing Portal** — customer enters a phone number and requests a short-lived pairing code.
2. **Central API** — authenticates portal requests, rate-limits pairing, tracks customer and bot records.
3. **Bot Provisioner** — allocates a bot ID and schedules an isolated HASA BOT instance on a suitable registered server.
4. **Server Agent** — outbound-only authenticated telemetry agent reporting capacity and server health.
5. **Isolated Worker** — outbound HTTPS worker that claims only server-bound allow-listed jobs; it never runs arbitrary shell commands.
6. **Session Security** — Baileys auth files live on a dedicated encrypted filesystem per server; short-lived pairing codes use an AES-256-GCM one-time database vault.
7. **Release Manager** — planned versioned rollout and rollback system for the shared HASA BOT codebase.
8. **Owner Console** — sole administrative control plane for servers, customers, instances, releases and audit events.

Website design and all platform-wide settings are owner-only. Customers can manage only their own bot through explicitly permitted customer controls; they cannot edit the website, theme, pages, menus, navigation or global settings. This is a server-enforced authorization rule, not merely a hidden UI option. See [Owner Design Policy](./OWNER_DESIGN_POLICY.md) and [Owner API documentation](./OWNER_API.md).

## Suggested implementation order

- Phase 0: architecture, threat model and operational boundaries.
- Phase 1: central API, database schema, owner authentication and audit log.
- Phase 2: one-time server registration, authenticated heartbeat and read-only monitoring agent.
- Phase 3: customer pairing portal and one-time pairing flow.
- Phase 4: per-customer instance provisioning and encrypted session storage.
- Phase 5: staged global updates, health checks and rollback.
- Phase 6: customer self-service, billing and subscription lifecycle.

## Current status

Foundation, ordered PostgreSQL migrations, one-time enrollment exchange and authenticated heartbeat API are implemented on the development branch. Migrations 002–004 add customer account/session records, per-instance runtime metadata, pairing lifecycle records, a future session-vault schema, encrypted one-time pairing-code fields and an allow-listed provisioning job queue. Actual Baileys auth files are stored per instance on an encrypted filesystem volume; the database session-vault table is schema groundwork and is not yet the auth-file storage adapter. The migration runner tracks applied files in schema_migrations and applies numbered SQL migrations once. Enrollment tickets are stored as hashes, expire, are consumed transactionally, and produce a unique one-time agent token whose hash is stored. Heartbeats use token-hash authentication, bounded validation and replay protection. The PostgreSQL adapter is wired to an optional `DATABASE_URL`; the initial schema can be applied with `npm run db:migrate`, and `/readyz` reports storage configuration. Owner login and protected one-time ticket creation API are implemented using a deployment-only `HASA_OWNER_ACCESS_KEY` and 30-minute signed sessions. A responsive public landing website is served at `/` with locally hosted assets and a restrictive content security policy; the owner console remains at `/owner`. A customer workspace is served at `/customer` with customer registration/login, short-lived bearer sessions, tenant-scoped dashboard data and pairing-request intake. Owner-only server inventory and server-agent revocation endpoints are also implemented. A responsive owner dashboard is served at `/owner`; it keeps the 30-minute owner token in tab memory, supports server inventory, one-time ticket creation and server revocation, and refreshes telemetry every 30 seconds. The telemetry agent supports one-time enrollment and outbound authenticated heartbeats; a separate worker service uses the same server-bound credential over HTTPS for allow-listed provisioning tasks. Customer registration/login, customer session management, a tenant-scoped bot dashboard and pairing-request intake API are now implemented. Passwords use salted scrypt hashes; random customer session tokens are stored only as SHA-256 hashes and expire after seven days. Pairing requests are stored in PostgreSQL and can be viewed only by their owning customer. A per-server Baileys worker now claims allow-listed pairing jobs through the authenticated HTTPS agent API. It requests real WhatsApp pairing codes and hands them to the central API, where they are encrypted with AES-256-GCM and stored only until one-time customer retrieval or expiry. The Owner Console can list customer bot instances and assign them to online enrolled servers. Worker auth-state files require a dedicated encrypted filesystem mount; the installer refuses to run unless that mount is present. This code path has automated unit/API tests, but it has not yet been validated against a real WhatsApp account on a live enrolled server. Per-customer HASA bot runtime provisioning, customer-owned start/stop/restart controls, worker restart recovery and resource-aware RAM admission are now implemented in this branch. These paths still require integration tests on an isolated enrolled server. Release manager/rollback, customer billing/quotas, robust crash-loop policy, HTTPS deployment, production secret setup and end-to-end tests against real WhatsApp accounts remain outstanding. The API fails closed when storage is unavailable. This directory is separate from the existing bot runtime. No server, PM2 process, WhatsApp session or production configuration has been changed.
