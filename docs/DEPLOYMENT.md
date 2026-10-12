# Deploy and recover

No public deployment has been performed. The app hostname is `og.growcdx.com` and the proposed messaging hostname is `messages.og.growcdx.com`. A Linux Docker host with persistent storage and inbound ports 80/443 is required. Size CPU/memory from actual load; the production overlay limits the engine web and worker to 2 GB each, PostgreSQL to 2 GB, the app to 512 MB, Redis to 512 MB and Caddy to 256 MB, so plan for at least 8 GB of RAM. The research brief's performance target is not yet met.

## Prepare

Transfer the source and private configuration securely. Run the local setup once to initialize a fresh installation. Choose your real DNS names and prepare configuration:

```sh
npm ci
npm run setup
OG_APP_HOST=<your-app-hostname> OG_MESSAGING_HOST=<your-messaging-hostname> npm run prepare:production
```

Replace angle-bracket labels with real hostnames before running. The preparation command creates private `.local/production.env`, `.local/app.production.env`, and `.local/engine.production.env`; the overlay applies the public `FRONTEND_URL` while development configuration remains intact. It starts no deployment and refuses to overwrite an existing production configuration. Read and edit those files privately:

- `.local/production.env`: `OG_MONITOR_IPS` (one IP or CIDR allowed to call `/api/health` from outside) and `OG_ADMIN_IPS` (one IP or CIDR allowed to open the engine console at `/super_admin` and `/monitoring`). Both default to `127.0.0.1`, which admits nobody from outside the host.
- `.local/app.production.env`: `CSP_MODE=report-only` to start; `REALTIME_MAX_STREAMS`; optional `CSP_IMAGE_SOURCES`/`CSP_CONNECT_SOURCES` for an attachment storage host.
- `.local/engine.production.env`: `WEB_CONCURRENCY=2`; optional `SENTRY_DSN`; optional `RACK_ATTACK_ALLOWED_IPS` for office egress addresses that would otherwise trip the engine's hardcoded sign-in throttle of five attempts per five minutes per address (use sparingly, it bypasses every throttle for those addresses); optional object storage settings.

Replace the initial owner's email/password through native administration and configure transactional SMTP and provider apps before onboarding a team. After the owner has signed in and changed the password, delete `.local/bootstrap-credentials.json`; repeat setup keeps the owner by stored ID through `.local/bootstrap-state.json` and never resets the password. The owner is also the engine super admin unless setup ran with `OG_SUPER_ADMIN=0`.

Point both DNS names to the host. Enable TCP 80/443 and optional HTTP/3 UDP 443. Caddy obtains certificates and redirects HTTP to HTTPS; its data volume persists certificates. Rails `FORCE_SSL=false` is intentional behind Caddy because internal service traffic and health checks use HTTP; as a consequence the engine's own `_chatwoot_session` cookie (used only by the super-admin console) is not marked `Secure`, and HSTS comes from Caddy rather than Rails. Public TLS is enforced by the proxy. Do not expose the app container directly: `TRUST_PROXY=true` relies on Caddy replacing `X-Real-IP`, and the app forwards that address to the engine on every request so rate limits and audit logs see real visitors. If another proxy is added, explicitly configure its trusted addresses and validate client-IP handling; otherwise every visitor would share one address and the sign-in throttle would lock the whole team out.

```sh
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml build app
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml up -d
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml ps
```

On a managed network requiring a supplied trusted CA, add `-f compose.build-ca.yaml` and set `OG_NETWORK_CA` to the provided CA bundle path for the build. The Dockerfile mounts it only as a build secret. Never disable TLS or package integrity verification. The cloud sandbox also needs a writable `BUILDX_CONFIG`, such as the checkout's `.local/buildx` directory.

Validate the public health endpoint from the monitoring address, sign-in/MFA/logout, website customer message and agent reply, private notes, origin rejection, each authorized provider webhook, and that unsigned provider callbacks are rejected. The engine's port 3001 is not published in production; PostgreSQL/Redis are private Docker services. Keep account signup disabled unless deliberately implementing your registration policy.

## Content Security Policy rollout

Pages carry a nonce-based policy in report-only mode by default. Run the workspace for a day of normal use, then search the app logs for `content security policy violation`. Each line names the directive, the blocked URL and the page. Add legitimate origins to `CSP_IMAGE_SOURCES` or `CSP_CONNECT_SOURCES`, then set `CSP_MODE=enforce` in `.local/app.production.env` and restart the app container. `CSP_MODE=off` disables the header for troubleshooting only.

## Backups and cloud snapshots

`npm run backup` (with `OG_PRODUCTION=1` on production) streams an online PostgreSQL dump and an archive of attachment storage into a timestamped directory under `.local/backups`, writes SHA-256 checksums, keeps the newest `OG_BACKUP_KEEP` backups (default 14) and runs the optional `OG_BACKUP_UPLOAD` command with the directory as `$1`, for example `restic -r s3:... backup "$1" .local/engine.env .local/engine.production.env .local/app.production.env .local/bootstrap-state.json`. No service is paused. Schedule it nightly with `deploy/omnigrow-backup.cron` and verify the upload destination once by restoring on a scratch host. Dumps contain provider credentials (the WhatsApp access token is stored unencrypted by the engine), so the backup store must be encrypted and the encryption keys from `.local/engine.env` kept in a separate secret store.

`npm run snapshot` briefly pauses Rails, Sidekiq, and Redis, saves a PostgreSQL dump plus storage/Redis archives, verifies SHA-256 hashes, retains the previous snapshot, then starts services again. On production use **`OG_PRODUCTION=1 npm run snapshot`** (and the same flag for backup/restore/setup/migrate) so the maintenance commands preserve the production Compose overlay during restart. Schedule a maintenance window, weekly in the example cron file. Save the snapshot, all encryption keys, environment files, `.local/bootstrap-state.json`, and `.local/runtime.json` together in encrypted storage off the host.

Automatic cloud restoration is designed for empty Docker volumes. It waits for PostgreSQL/Redis health, checks database tables, Redis key count, and attachment storage before restoring, and refuses to overwrite recognized or unknown existing data. Existing installations keep their database on repeated setup. A private `restore-in-progress-<project>.json` marker blocks subsequent automatic startup after an interrupted partial restore. Diagnose all three components before manually clearing that marker; no automatic destructive reset is performed.

For an empty replacement host/cloud runtime, securely restore the checkout, private configuration, and `.local/snapshot`, then run:

```sh
npm ci
npm run setup
```

For a production host, use the production Compose overlay again after verifying the restored state. A separate empty-volume recovery check now passes for database records, a real stored attachment, and Redis state. To repeat it on the default local installation, run `npm run test:recovery`; it pauses messaging twice, creates its own disposable project and probes, removes them afterward, and retains a clean snapshot. It requires at least 1 GiB additional free disk and is deliberately unavailable for production or a custom Compose project. Run a restore drill from an uploaded backup on a scratch host at least monthly.

## Upgrade

The engine container does not migrate its database on boot. To move to a new pinned engine release: read the upstream release notes, take `OG_PRODUCTION=1 npm run snapshot`, change the digest in `compose.yaml`, pull it, run `OG_PRODUCTION=1 npm run migrate` (which applies `rails db:chatwoot_prepare`), then `docker compose ... up -d` so web and worker start on the new release. Rebuild the app image when the Next.js source changes. Test the sequence in an isolated environment first and verify a restore before accepting new traffic.

## Operations

Monitor frontend/backend health, Sidekiq failures and queue latency, database/storage growth, provider delivery errors (`message.status = failed`), mail delivery, webhook failures, `[Rack::Attack][Blocked]` log lines, `[OmniGrow] Rejected Twilio callback` lines, `[LINE] Invalid webhook signature` lines and `content security policy violation` lines. Container logs are capped at five 50 MB files per service. Both tiers emit JSON logs carrying the request id that Caddy assigns (`X-Request-ID`); the same id is shown to users as a reference on error notices. Engine logs include request parameters and provider payloads at info level, so treat log storage as customer data with access control and retention. Account webhook signatures cover `timestamp + '.' + raw_body` with HMAC-SHA256 and are sent as `X-Chatwoot-Timestamp` and `X-Chatwoot-Signature`; preserve the raw body when verifying. Native ordinary-webhook failures are logged, not automatically retried. Bot retries depend on the native response contract.

Attachments live on the `storage` volume and are served by the engine. For more than one host, or to keep uploads out of the database host's disk, configure an S3-compatible bucket with private objects through the engine's `ACTIVE_STORAGE_SERVICE` settings and add its origin to `CSP_IMAGE_SOURCES`. Review upstream security updates before moving pinned versions. Keep local snapshots and bootstrap credentials out of Git; all are covered by .gitignore and excluded from Docker builds.
