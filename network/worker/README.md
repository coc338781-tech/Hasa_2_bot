# HASA BOT NETWORK — per-server WhatsApp worker

This service runs separately on each enrolled Linux/Oracle server. It does not connect directly to PostgreSQL and does not accept arbitrary shell commands. It authenticates to the central API using that server's enrolled agent token over HTTPS.

## Pairing lifecycle

1. Owner assigns a customer's bot instance to an online server through the Owner Console.
2. Customer submits an international WhatsApp number from their private workspace.
3. The API creates a tenant-scoped pairing request and an allow-listed `pairing_start` job for the assigned server.
4. That server's worker claims only jobs leased to its server identity.
5. Baileys requests a real WhatsApp pairing code after its socket readiness event.
6. The worker sends the code to the central API over the authenticated HTTPS channel.
7. The API encrypts the code using AES-256-GCM before storing it in PostgreSQL. The raw code is never logged or stored in plaintext.
8. The customer API returns the code once, only when the authenticated customer owns the latest pairing request. The encrypted value is deleted on retrieval or expiry.

The worker can execute only the job types explicitly exposed by the API. It cannot send remote shell commands, choose file paths, or access another server's jobs.

## Install on an enrolled server

Prerequisites:
- Node.js 22 or newer.
- The telemetry agent has enrolled successfully and has `/var/lib/hasa-agent/credentials.json`.
- A dedicated encrypted filesystem is mounted exactly at `/var/lib/hasa-worker/sessions`.
- The central API is reachable using HTTPS and has the database migrations applied.
- The API environment has `HASA_PAIRING_CODE_KEY`, generated using `openssl rand -base64 32`. The same key must be protected by the central deployment secret manager; do not copy it to workers.

Install:

```bash
cd network/worker
sudo bash install-systemd.sh
sudo systemctl enable --now hasa-worker
sudo systemctl status hasa-worker
sudo journalctl -u hasa-worker -n 100 --no-pager
```

The installer refuses to proceed unless the session directory is already a mount point. It creates a dedicated `hasa-worker` account, copies the runtime to `/opt/hasa-network`, and writes the enrolled server's API token into a root-managed, group-restricted service environment file. It does not print the token.

## Session security

Baileys multi-file auth state is sensitive credential material. File mode `0700` is not encryption. The configured session directory must be backed by an encrypted volume whose key is not stored on the same filesystem. This first worker implementation relies on that encrypted volume for Baileys auth files. The separate pairing-code vault uses AES-256-GCM with a key held outside PostgreSQL and Git.

## Resource limits

The systemd service is capped at 768 MB and starts with one concurrent pairing session by default. Increase `HASA_WORKER_MAX_SESSIONS` only after measuring real free RAM and testing the server under load. The API/worker service is separate from the existing production `hasa2` PM2 process.

## Remaining integration gates

- Pairing worker and encrypted one-time code handoff are implemented in this branch, but have not yet been validated against a real WhatsApp account on a live enrolled server.
- The full HASA bot plugin runtime is not yet provisioned as a per-customer service after WhatsApp pairing.
- Server-side RAM admission control, instance start/stop/restart, release rollout/rollback, and end-to-end recovery after worker restart still require implementation and tests.
- HTTPS reverse-proxy configuration, production database/key setup, and server enrollment are deployment tasks. Do not publish or enable the worker on the production Oracle host until these are complete and explicitly approved.
