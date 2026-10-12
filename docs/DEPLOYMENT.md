# Deploy and recover

No public deployment has been performed. The app hostname is `og.growcdx.com` and the proposed messaging hostname is `messages.og.growcdx.com`. A Linux Docker host with persistent storage and inbound ports 80/443 is required. Size CPU/memory from actual load; the research brief's performance target is not yet met.

## Prepare

Transfer the source and private configuration securely. Run the local setup once to initialize a fresh installation. Choose your real DNS names and prepare configuration:

```sh
npm ci
npm run setup
OG_APP_HOST=<your-app-hostname> OG_MESSAGING_HOST=<your-messaging-hostname> npm run prepare:production
```

Replace angle-bracket labels with real hostnames before running. Production files for the specified hostnames are already prepared here. The preparation command creates private `.local/production.env`, `.local/app.production.env`, and `.local/engine.production.env`; the overlay applies the public `FRONTEND_URL` while development configuration remains intact. It starts no deployment and refuses to overwrite an existing production configuration. Read and edit those files privately. Replace the initial owner's email/password through native administration and configure transactional SMTP and provider apps before onboarding a team. Repeat setup retains the owner by stored ID after an email change and does not reset the password.

Point both DNS names to the host. Enable TCP 80/443 and optional HTTP/3 UDP 443. Caddy obtains certificates and redirects HTTP to HTTPS; its data volume persists certificates. Rails `FORCE_SSL=false` is intentional behind Caddy because internal service traffic and health checks use HTTP. Public TLS is enforced by the proxy. Do not expose the app container directly: `TRUST_PROXY=true` relies on Caddy replacing `X-Real-IP`. If another proxy is added, explicitly configure its trusted addresses and validate client-IP handling.

```sh
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml build app
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml up -d
docker compose --env-file .local/production.env -f compose.yaml -f compose.production.yaml ps
```

On a managed network requiring a supplied trusted CA, add `-f compose.build-ca.yaml` and set `OG_NETWORK_CA` to the provided CA bundle path for the build. The Dockerfile mounts it only as a build secret. Never disable TLS or package integrity verification. The cloud sandbox also needs a writable `BUILDX_CONFIG`, such as the checkout's `.local/buildx` directory.

Validate the public health endpoint, sign-in/MFA/logout, website customer message and agent reply, private notes, origin rejection, and each authorized provider webhook. The engine's port 3001 remains loopback only; PostgreSQL/Redis are private Docker services. Keep account signup disabled unless deliberately implementing your registration policy.

## Backups and cloud snapshots

`npm run backup` streams an online PostgreSQL dump into `.local/backups`. This alone does not contain attachments or queue state. `npm run snapshot` briefly pauses Rails, Sidekiq, and Redis, saves a PostgreSQL dump plus storage/Redis archives, verifies SHA-256 hashes, retains the previous snapshot, then starts services again. On production use **`OG_PRODUCTION=1 npm run snapshot`** (and the same flag for backup/restore/setup) so the maintenance commands preserve the production Compose overlay during restart. Schedule a maintenance window. Save the snapshot, all encryption keys, environment files, `.local/bootstrap-state.json`, `.local/bootstrap-credentials.json`, and `.local/runtime.json` together in encrypted storage off the host. The bootstrap state retains the existing owner identity after an email change.

Automatic cloud restoration is designed for empty Docker volumes. It waits for PostgreSQL/Redis health, checks database tables, Redis key count, and attachment storage before restoring, and refuses to overwrite recognized or unknown existing data. Existing installations keep their database on repeated setup. A private `restore-in-progress-<project>.json` marker blocks subsequent automatic startup after an interrupted partial restore. Diagnose all three components before manually clearing that marker; no automatic destructive reset is performed.

For an empty replacement host/cloud runtime, securely restore the checkout, private configuration, and `.local/snapshot`, then run:

```sh
npm ci
npm run setup
```

For a production host, use the production Compose overlay again after verifying the restored state. A separate empty-volume recovery check now passes for database records, a real stored attachment, and Redis state. To repeat it on the default local installation, run `npm run test:recovery`; it pauses messaging twice, creates its own disposable project and probes, removes them afterward, and retains a clean snapshot. It requires at least 1 GiB additional free disk and is deliberately unavailable for production or a custom Compose project. Publication and a future cloud task are separate operations and have not been verified here. See [validation](VALIDATION.md) for the exact status.

## Operations

Monitor frontend/backend health, Sidekiq failures and queue latency, database/storage growth, provider delivery errors, mail delivery, and webhook failures. Account webhook signatures cover `timestamp + '.' + raw_body` with HMAC-SHA256 and are sent as `X-Chatwoot-Timestamp` and `X-Chatwoot-Signature`; preserve the raw body when verifying. Native ordinary-webhook failures are logged, not automatically retried. Bot retries depend on the native response contract.

Review upstream security updates before moving pinned versions. Take a consistent snapshot before migrations, test the upgrade in an isolated environment, and verify a restore before accepting new traffic. Keep local snapshots and bootstrap credentials out of Git; all are covered by .gitignore and excluded from Docker builds.
