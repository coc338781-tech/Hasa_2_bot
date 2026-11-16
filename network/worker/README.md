# Isolated WhatsApp worker

This package contains the first isolated Baileys pairing runtime component for HASA BOT NETWORK.

## Current scope

- Uses the repository's pinned Baileys `7.0.0-rc14` API.
- Maintains a separate Baileys auth directory for each validated bot-instance UUID.
- Restricts each auth directory to owner-only permissions (`0700`).
- Requests the real WhatsApp pairing code only after Baileys emits its pairing-readiness QR event.
- Delivers the raw pairing code only to the injected `onPairingCode` callback. It never logs the code or includes it in status events.
- Exposes explicit pairing/paired/offline/expired/stopped states and a configurable in-memory session cap.
- Never deletes auth state when a socket closes.

## Integration contract

The host control plane must provide:
- An authenticated, tenant-scoped callback that delivers a short-lived pairing code only to the owner of that bot instance.
- A persistent status callback that updates only the matching bot instance and pairing request.
- A server-side job lease so two workers cannot claim the same pairing request.
- A configured capacity limit based on measured free RAM before starting sessions.

The worker is not exposed directly to customer browsers. Never send the code through logs, analytics, error telemetry or an unscoped API response.

## Storage and production gate

Baileys multi-file auth state is sensitive credential material. The directory permission mode is not encryption. Production workers must place `dataDir` on an encrypted volume (or replace the auth-state adapter with the encrypted vault adapter backed by the existing AES-GCM/KMS design) and must keep encryption keys outside PostgreSQL and Git. Do not use an ordinary unencrypted host directory for production customer sessions.

## Not yet a live customer pairing service

This component is not yet connected to the customer API, PostgreSQL job leasing, encrypted auth vault, server agent command channel, customer polling endpoint, or full Hasa bot plugin runtime. The customer website must continue to report pairing as unavailable until those integrations are implemented and tested end-to-end. This module alone does not mean that customer pairing is live.
