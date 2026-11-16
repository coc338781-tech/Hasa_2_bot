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
9. After WhatsApp confirms the link, the worker saves credentials, closes the temporary pairing socket, and queues an isolated bot start.
10. The shared HASA bot code runs as a separate child process with its own working directory, `config.json`, `auth_info`, message cache and downloads. The selected WhatsApp number becomes that bot's owner number.

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
sudo env HASA_CONFIRM_ENCRYPTED_VOLUME=true bash install-systemd.sh
sudo systemctl enable --now hasa-worker
sudo systemctl status hasa-worker
sudo journalctl -u hasa-worker -n 100 --no-pager
```

The installer refuses to proceed unless the session directory is already a mount point and the operator explicitly confirms that the mounted filesystem is encrypted at rest. Verify the mount encryption before setting that confirmation; the script cannot independently verify every supported filesystem encryption scheme. It creates a dedicated `hasa-worker` account, installs the control-plane worker to `/opt/hasa-network`, copies the shared HASA bot source to `/opt/hasa-bot`, installs both dependency sets, and writes the enrolled server's API token into a root-managed, group-restricted service environment file. It does not print the token.

## Session security

Baileys multi-file auth state is sensitive credential material. File mode `0700` is not encryption. The configured session directory must be backed by an encrypted volume whose key is not stored on the same filesystem. This first worker implementation relies on that encrypted volume for Baileys auth files. The separate pairing-code vault uses AES-256-GCM with a key held outside PostgreSQL and Git.

## Resource limits

The systemd worker service is capped at 768 MiB and starts with one active bot/pairing session by default. Separately, the Owner Console controls the host free-RAM reserve (default 768 MiB); the worker fetches that setting from the API every 15 seconds, reports its heartbeat and active session count, and pauses new pairing/start/restart jobs below it. Owner Console shows the worker as online only while its heartbeat is fresher than 90 seconds. The reserve is not the worker memory cap, and neither limit guarantees a particular number of bots will fit. Increase `HASA_WORKER_MAX_SESSIONS` and the systemd `MemoryMax` only after measuring real RAM and testing under load. Change the live admission reserve in Owner Console; `HASA_MIN_FREE_MEMORY_BYTES` is only a fallback default. The API/worker service is separate from the existing production `hasa2` PM2 process.

## Remaining integration gates

- Pairing worker and encrypted one-time code handoff are implemented in this branch, but have not yet been validated against a real WhatsApp account on a live enrolled server.
- Per-customer bot runtime provisioning and customer-owned start/stop/restart controls are implemented, with health-file reporting and worker restart recovery; these paths still require integration tests on an isolated enrolled server.
- Release rollout/rollback, customer billing/quotas, robust crash-loop policy, and end-to-end tests against real WhatsApp accounts still require implementation.
- HTTPS reverse-proxy configuration, production database/key setup, and server enrollment are deployment tasks. Do not publish or enable the worker on the production Oracle host until these are complete and explicitly approved.
