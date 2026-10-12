# Production readiness

Status after the hardening release on this branch. The engine is Chatwoot 4.18.0 pinned by its tag digest; the workspace is Next.js 16.4.0. What follows is what the code now guarantees, what the operator still has to do before the first customer conversation, and what remains out of scope.

## What the hardening release changed

Security and authenticity

- WhatsApp Cloud channels are created with the Meta app secret, so the engine verifies `X-Hub-Signature-256` on every webhook instead of accepting unsigned payloads (`src/components/channels.tsx`, `docs/CHANNELS.md`).
- Twilio SMS callbacks are signature-checked by an initializer mounted into the engine (`deploy/engine/zz_omnigrow_twilio_signature.rb`); unsigned or tampered callbacks get `403`.
- Every engine request carries the real client address and the request id, so the engine's rate limits, sign-in throttle and audit trail apply per visitor rather than to the app container (`src/lib/server.ts`).
- Health probes use the engine's rate-limit-exempt route, and Caddy exposes `/api/health` and the engine console only to configured addresses (`deploy/Caddyfile`).
- Callback endpoints registered through the workspace must be HTTPS (`src/lib/policy.ts`).
- A nonce-based Content Security Policy is sent in report-only mode with a violation log endpoint, ready to enforce (`src/lib/csp.ts`, `src/proxy.ts`).
- Request bodies are read with a byte counter so chunked uploads cannot bypass the 20 MB limit.

Sessions and realtime

- Sessions expire after eight idle hours or twenty-four hours total and renew on activity; the fixed eight-hour cut-off that logged whole teams out together is gone (`src/lib/session-policy.ts`).
- Live event streams are capped at six per sign-in and share one authorization check per sign-in instead of one per tab (`src/lib/realtime-server.ts`).
- Streams close on SIGTERM so deployments do not wait on them, and the production overlay allows a 20-second drain.
- Logout always destroys the local session, even when the engine cannot be reached.
- Users in many workspaces no longer hit the 4 KB cookie limit.

Reliability and operations

- Online backups with checksums, retention and an upload hook (`npm run backup`), a cron example, and an explicit migration step for upgrades (`npm run migrate`).
- Structured JSON logs with request ids on both tiers; readable client errors for proxy-generated 413 and 502 pages; error notices show a reference id.
- Memory limits, bounded container logs and `no-new-privileges` on every service; the engine's loopback port is not published in production.
- Engine defaults: telemetry off, upload limit aligned at 20 MB, structured request logs, two Puma processes in production.
- The owner is also the engine super admin, so installation settings and the job dashboard are reachable (console restricted to operator addresses).
- Duplicate-send protection after gateway errors, an assignment conflict check, and reports hidden for agents (the engine restricts them to administrators).
- GitHub Actions: typecheck, unit tests, build, configuration validation and image build on every push; nightly browser suite against the real engine; Dependabot for packages, images and actions.

## Before the first production conversation

1. Prepare and review `.local/production.env`, `.local/app.production.env`, `.local/engine.production.env` (`docs/DEPLOYMENT.md`). Set `OG_MONITOR_IPS` and `OG_ADMIN_IPS`.
2. Point DNS, open 80/443, build and start the production overlay, confirm certificates.
3. Sign in as the owner, change the email and password, delete `.local/bootstrap-credentials.json`.
4. Configure transactional SMTP; invitations and password resets do not work without it.
5. Install the backup cron with an encrypted off-host destination and run one restore drill on a scratch host.
6. Connect channels with real provider credentials and complete the external acceptance checklist in `docs/CHANNELS.md`, including the unsigned-callback checks.
7. Run the workspace in CSP report-only mode for a day, then set `CSP_MODE=enforce`.
8. Point an uptime monitor at `/api/health` from the configured address and ship logs somewhere with retention; add `SENTRY_DSN` if you use Sentry.
9. Load test with your expected number of concurrent agents; the repository's own measurements cover 2,000 idle connections and one active conversation, not a busy team.

## Known limits that remain

- The native engine UI and API stay reachable on the messaging hostname with the same credentials; the workspace allowlist is a product boundary, not a security boundary.
- Telegram callbacks are authenticated only by the bot token in the path; the engine does not support Telegram's `secret_token` header.
- Attachment type and size are validated by the engine only for website-widget uploads; there is no malware scanning. Object storage with private objects is recommended for production.
- The engine stores the WhatsApp access token and app secret unencrypted in `provider_config`; database dumps must be encrypted.
- Account webhooks are not retried by the engine; consumers need idempotency and monitoring.
- The engine's sign-in throttle is five attempts per five minutes per address; shared office addresses may need `RACK_ATTACK_ALLOWED_IPS`.
- Horizontal scaling of the app is possible (stateless cookies) but logout revocation on other instances is bounded by the 20-second authorization check.
- Engine logs include request parameters and provider payloads; treat them as customer data.

## Easier sign-in and channel connection

Recommended next increments, all backed by existing engine capabilities: Meta embedded signup for WhatsApp (replaces copying four credentials and verifies signatures by construction), OAuth mailboxes for Gmail and Microsoft 365 instead of app passwords, Google sign-in through the engine's `sso_auth_token` exchange in the branded login, and transactional SMTP so password resets and invitations are self-service. See the last section of `docs/CHANNELS.md`.
