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
4. **Server Agent** — outbound-only authenticated agent reporting capacity and executing a narrow allow-listed set of operations.
5. **Session Vault** — encrypts and stores each instance's Baileys credentials separately.
6. **Release Manager** — builds one versioned HASA BOT release, tests it, then rolls it out gradually with rollback support.
7. **Owner Console** — sole administrative control plane for servers, customers, instances, releases and audit events.

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

Foundation, ordered PostgreSQL migrations, one-time enrollment exchange and authenticated heartbeat API are implemented on the development branch. Migration 002 adds customer account/session records, per-instance runtime metadata, pairing lifecycle records, encrypted WhatsApp session-vault storage, and an allow-listed provisioning job queue. The migration runner tracks applied files in schema_migrations and applies numbered SQL migrations once. Enrollment tickets are stored as hashes, expire, are consumed transactionally, and produce a unique one-time agent token whose hash is stored. Heartbeats use token-hash authentication, bounded validation and replay protection. The PostgreSQL adapter is wired to an optional `DATABASE_URL`; the initial schema can be applied with `npm run db:migrate`, and `/readyz` reports storage configuration. Owner login and protected one-time ticket creation API are implemented using a deployment-only `HASA_OWNER_ACCESS_KEY` and 30-minute signed sessions. A responsive public landing website is served at `/` with locally hosted assets and a restrictive content security policy; the owner console remains at `/owner`. Owner-only server inventory and server-agent revocation endpoints are also implemented. A responsive owner dashboard is served at `/owner`; it keeps the 30-minute owner token in tab memory, supports server inventory, one-time ticket creation and server revocation, and refreshes telemetry every 30 seconds. The agent supports one-time enrollment and outbound authenticated heartbeats. End-to-end deployment, HTTPS reverse proxy, a customer pairing portal, actual customer authentication endpoints, a Baileys pairing worker, instance provisioning executors, key-management integration for the encrypted session vault and release manager are not yet implemented. The new tables are schema groundwork only; no pairing code can be generated or bot provisioned yet. The API fails closed when storage is unavailable. This directory is separate from the existing bot runtime. No server, PM2 process, WhatsApp session or production configuration has been changed.
