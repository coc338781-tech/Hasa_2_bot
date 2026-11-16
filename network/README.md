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

## Suggested implementation order

- Phase 0: architecture, threat model and operational boundaries.
- Phase 1: central API, database schema, owner authentication and audit log.
- Phase 2: server registration and read-only monitoring agent.
- Phase 3: customer pairing portal and one-time pairing flow.
- Phase 4: per-customer instance provisioning and encrypted session storage.
- Phase 5: staged global updates, health checks and rollback.
- Phase 6: customer self-service, billing and subscription lifecycle.

## Current status

Foundation branch created. This directory is intentionally separate from the existing bot runtime. No server, PM2 process, WhatsApp session or production configuration has been changed.
