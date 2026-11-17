# Owner-only Website Design and Platform Control

## Product rule

The HASA BOT NETWORK website is customer-facing, but its design and platform configuration are owner-controlled. Customers must never be able to edit the website itself.

## Roles

### Platform owner
Only the single platform owner may:
- change website branding, colors, layout, navigation, page content and feature visibility;
- manage global platform settings, registered servers, capacity rules and releases;
- view cross-tenant operational information and perform audited platform administration;
- approve and publish website or platform changes.

Owner design controls must be protected by server-side owner authentication and authorization. Hiding controls in the browser is not an authorization boundary.

### Customer
An authenticated customer may:
- view and manage only their own bot instance and account details;
- request WhatsApp pairing, view their own pairing state and bot status;
- use only customer-level bot settings and actions explicitly enabled by the platform owner;
- request support.

Customers must not:
- edit website themes, branding, page content, menus, navigation or global settings;
- create or manage servers, other customers, releases or platform-wide jobs;
- access another customer's bot, phone number, credentials, logs or session data;
- invoke owner APIs or change their own role/permissions.

## Enforcement requirements

1. Derive the role from the authenticated server-side session/account record. Never trust a role, customer ID or owner flag supplied by browser input.
2. Require owner authorization on every owner/design-management API route, regardless of whether the UI exposes the control.
3. Require customer authorization and tenant scoping on every customer route; resolve the customer identity from the session, not request parameters.
4. Deny by default. Unknown roles, missing sessions, expired sessions and unavailable authorization stores must fail closed.
5. Keep owner sessions separate from customer sessions. Do not allow a customer token to be accepted by owner endpoints.
6. Record owner design and global-setting changes in an append-only audit log, including actor, action, target and timestamp; never log secrets.
7. Keep customer-facing UI free of website editor/theme controls. Customer bot settings must be clearly distinct from website/platform settings.
8. Add automated authorization tests for anonymous, customer and owner access to every protected route before enabling the portal publicly.

## Website change workflow

The owner may request website changes through the project maintenance workflow. Changes should be made on a development branch, reviewed and tested, then published only after explicit owner approval. Customer accounts do not receive repository, deployment or website-editor access.

## Current implementation status

This document records the approved access-control requirement. The customer authentication/portal and website design editor are not yet implemented. The existing owner console currently protects only the owner operations documented in OWNER_API.md; do not imply that the full customer portal or design editor is live.
