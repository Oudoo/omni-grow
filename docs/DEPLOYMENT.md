# Deploy and recover

No public deployment has been performed. The app hostname is `og.growcdx.com`; choose separate messaging, meeting and TURN hostnames. Use a Linux Docker host with persistent storage, a public IPv4 address and Compose 2.24.4 or newer. The overlay limits Rails, Sidekiq, PostgreSQL and LiveKit to 2 GiB each, the app/Redis to 512 MiB each, and Caddy/HAProxy to 256 MiB each. Start with at least 12 GiB RAM and size CPU/network/storage from measured workload. Employee-seat allowances do not establish concurrent call capacity. The research brief's performance target is not yet met.

## Prepare

Transfer the source and private configuration securely. Run the local setup once to initialize a fresh installation. Choose your real DNS names and prepare configuration:

```sh
npm ci
npm run setup
# Export your actual values privately before this command:
# OG_APP_HOST, OG_MESSAGING_HOST, OG_MEETINGS_HOST, OG_TURN_HOST,
# OG_VPS_PUBLIC_IP, OG_TURN_CERT_FILE, OG_TURN_KEY_FILE.
npm run prepare:production
```

Obtain a trusted certificate/full chain and matching private key for `OG_TURN_HOST` first (DNS-01 issuance with your DNS provider works before the app is online). The preparation command validates the hostnames, public address, certificate hostname/key and expiry, then creates private `.local/production.env`, `.local/app.production.env`, `.local/engine.production.env`, `.local/livekit.production.yaml` and `.local/turn-certs/`. It starts no deployment and refuses to overwrite existing production configuration. Development URLs remain intact. Read and edit the files privately:

- `.local/production.env`: `OG_MONITOR_IPS` (one IP or CIDR allowed to call `/api/health` from outside) and `OG_ADMIN_IPS` (one IP or CIDR allowed to open the engine console at `/super_admin` and `/monitoring`). Both default to `127.0.0.1`, which admits nobody from outside the host.
- `.local/app.production.env`: `CSP_MODE=report-only` to start; `REALTIME_MAX_STREAMS`; optional `CSP_IMAGE_SOURCES`/`CSP_CONNECT_SOURCES` for an attachment storage host.
- `.local/engine.production.env`: `WEB_CONCURRENCY=2`; optional `SENTRY_DSN`; optional `RACK_ATTACK_ALLOWED_IPS` for office egress addresses that would otherwise trip the engine's hardcoded sign-in throttle of five attempts per five minutes per address (use sparingly, it bypasses every throttle for those addresses); optional object storage settings.

Replace the initial owner's email/password through native administration and configure transactional SMTP for password recovery and native engine emails. Business invitations are private links that the administrator shares directly; they do not depend on SMTP. Configure provider apps for the external channels you intend to use. After the owner has signed in and changed the password, delete `.local/bootstrap-credentials.json`; repeat setup keeps the owner by stored ID through `.local/bootstrap-state.json` and never resets the password. The owner is also the engine super admin unless setup ran with `OG_SUPER_ADMIN=0`.

For hosted sales, use **Businesses → Manage subscription** to assign monthly/yearly terms or open-ended access independently from the package. See [subscription operation](BUSINESS.md#hosted-leases-and-subscriptions). Keep server time synchronized. Verify `omnigrow_subscription_expiry` is enabled in the native job dashboard and monitor the `critical` queue and `OmniGrow subscription meeting cleanup failed` logs. It runs every minute to end already-connected calls after expiry; API access checks do not wait for it. Payment collection remains manual until a real payment provider is integrated. Database backups include subscription terms and payment-reference history.

Point all four DNS names directly to the VPS; meeting/TURN records must not use a CDN that cannot forward raw WebRTC/TURN traffic. Publish TCP 80/443/7881, UDP 7882/3478/50000–50199, and optionally UDP 443 for HTTP/3. HAProxy routes TLS by SNI: TURN goes encrypted to LiveKit, and web traffic goes to Caddy with PROXYv2 client-address metadata. Caddy obtains the web certificates and redirects HTTP to HTTPS. Its internal TCP443 listener accepts PROXY metadata only from private networks and is not publicly published. LiveKit's administrative API, port 7880, stays private; Caddy exposes only its signaling routes. The 200-port TURN relay range is a starting resource budget; measure actual allocations/load before raising concurrency, and expand the LiveKit range and Compose mapping together if needed.

Rails `FORCE_SSL=false` is intentional behind Caddy because internal service traffic and health checks use HTTP; the engine's native console cookie is not marked `Secure`, so public TLS/HSTS enforcement belongs at Caddy. Do not expose the app or engine containers directly. `TRUST_PROXY=true` relies on Caddy replacing `X-Real-IP`, and HAProxy's PROXYv2 routing preserves the real visitor address for rate limits and console allowlists. If another proxy is added, configure and test its trusted-address handling.

```sh
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml build app
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml up -d
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml ps
```

On a managed network requiring a supplied trusted CA, add `-f compose.build-ca.yaml` and set `OG_NETWORK_CA` to the provided CA bundle path for the build. The Dockerfile mounts it only as a build secret. Never disable TLS or package integrity verification. The cloud sandbox also needs a writable `BUILDX_CONFIG`, such as the checkout's `.local/buildx` directory.

Validate the public health endpoint from the monitoring address, sign-in/MFA/logout, website customer message and agent reply, private notes, origin rejection, each authorized provider webhook, and that unsigned provider callbacks are rejected. The engine's port 3001 is not published in production; PostgreSQL/Redis are private Docker services. Keep account signup disabled unless deliberately implementing your registration policy.

Also test two businesses, administrator and employee permissions, cross-tenant/private document denial, branding, invitations, and suspension. Run a two-person call from different physical networks, test audio/video/screen sharing, then force relay-only ICE and verify TURN/TLS443 works. Test removal during a call and an old admission token after the meeting ends. A local browser/SFU pass does not establish public UDP reachability or certificate trust.

Renew the TURN certificate with your certificate client's deploy hook. Set `OG_TURN_CERT_FILE` and `OG_TURN_KEY_FILE` to the renewed full chain/key, then run `npm run meetings:renew-certificate` as the same service-file owner used for preparation. The command validates and installs the pair and restarts LiveKit; active calls disconnect and can start again. Keep this restart inside a maintenance window. Caddy renews its own web certificates separately. Restore the recorded `OG_SERVICE_UID/GID` ownership when transferring private meeting configuration to another server.

## Content Security Policy rollout

Pages carry a nonce-based policy in report-only mode by default. Run the workspace for a day of normal use, then search the app logs for `content security policy violation`. Each line names the directive, the blocked URL and the page. Add legitimate origins to `CSP_IMAGE_SOURCES` or `CSP_CONNECT_SOURCES`, then set `CSP_MODE=enforce` in `.local/app.production.env` and restart the app container. `CSP_MODE=off` disables the header for troubleshooting only.

## Backups and cloud snapshots

`npm run backup` (with `OG_PRODUCTION=1` on production) streams an online PostgreSQL dump and an archive of attachment storage into a timestamped directory under `.local/backups`, writes SHA-256 checksums, keeps the newest `OG_BACKUP_KEEP` backups (default 14) and runs the optional `OG_BACKUP_UPLOAD` command with the directory as `$1`. No service is paused; concurrent attachment deletion can race this online archive, so use a snapshot for a consistent release backup. Schedule backups with `deploy/omnigrow-backup.cron` and test restoration on a scratch host. Include the private engine/app environment files, LiveKit configuration, TURN certificate directory and bootstrap state in encrypted off-host backup storage. Database dumps contain provider credentials; keep encryption keys separately as well.

`npm run snapshot` briefly pauses Rails, Sidekiq, and Redis, saves a PostgreSQL dump plus storage/Redis archives, verifies SHA-256 hashes, retains the previous snapshot, then starts services again. On production use **`OG_PRODUCTION=1 npm run snapshot`** (and the same flag for backup/restore/setup/migrate) so the maintenance commands preserve the production Compose overlay during restart. Schedule a maintenance window, weekly in the example cron file. Save the snapshot, all encryption keys, environment files, `.local/bootstrap-state.json`, and `.local/runtime.json` together in encrypted storage off the host.

Automatic cloud restoration is designed for empty Docker volumes. It waits for PostgreSQL/Redis health, checks database tables, Redis key count, and attachment storage before restoring, and refuses to overwrite recognized or unknown existing data. Existing installations keep their database on repeated setup. A private `restore-in-progress-<project>.json` marker blocks subsequent automatic startup after an interrupted partial restore. Diagnose all three components before manually clearing that marker; no automatic destructive reset is performed.

For an empty replacement host/cloud runtime, securely restore the checkout, private configuration, and `.local/snapshot`, then run:

```sh
npm ci
npm run setup
```

For a production host, use the production Compose overlay again after verifying the restored state. A separate empty-volume recovery check now passes for database records, a real stored attachment, and Redis state. To repeat it on the default local installation, run `npm run test:recovery`; it pauses messaging twice, creates its own disposable project and probes, removes them afterward, and retains a clean snapshot. It requires at least 1 GiB additional free disk and is deliberately unavailable for production or a custom Compose project. Run a restore drill from an uploaded backup on a scratch host at least monthly.

## Upgrade

The engine container does not migrate its database on boot. To move to a new pinned engine release: read the upstream release notes, take `OG_PRODUCTION=1 npm run snapshot`, change the digest in `compose.yaml`, and pull it. Put the site into maintenance and stop the app, Rails and worker services before migrating so old code cannot write while the schema changes. Run `OG_PRODUCTION=1 npm run migrate`, which applies `rails db:chatwoot_prepare` in a disposable container using the configured image even if an older Rails container still exists. Then use the production Compose overlay to start the app, web and worker on the new release. Rebuild the app image when the Next.js source changes. Test the sequence in an isolated environment first and verify a restore before accepting new traffic.

## Operations

Monitor frontend/backend health, Sidekiq failures and queue latency, database/storage growth, provider delivery errors (`message.status = failed`), mail delivery, webhook failures, `[Rack::Attack][Blocked]` log lines, `[OmniGrow] Rejected Twilio callback` lines, `[LINE] Invalid webhook signature` lines and `content security policy violation` lines. Container logs are capped at five 50 MB files per service. Both tiers emit JSON logs carrying the request id that Caddy assigns (`X-Request-ID`); the same id is shown to users as a reference on error notices. Engine logs include request parameters and provider payloads at info level, so treat log storage as customer data with access control and retention. Account webhook signatures cover `timestamp + '.' + raw_body` with HMAC-SHA256 and are sent as `X-Chatwoot-Timestamp` and `X-Chatwoot-Signature`; preserve the raw body when verifying. Native ordinary-webhook failures are logged, not automatically retried. Bot retries depend on the native response contract.

Attachments live on the `storage` volume and are served by the engine. For more than one host, or to keep uploads out of the database host's disk, configure an S3-compatible bucket with private objects through the engine's `ACTIVE_STORAGE_SERVICE` settings and add its origin to `CSP_IMAGE_SOURCES`. Review upstream security updates before moving pinned versions. Keep local snapshots and bootstrap credentials out of Git; all are covered by .gitignore and excluded from Docker builds.
