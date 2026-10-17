# Validation and remaining work

Evidence applies to this cloud instance. The reusable configuration draft is saved; it has not been published or verified in a fresh task. No public deployment has been performed.

## Hosted subscriptions verified on 2026-10-17

The monthly/yearly subscription endpoint first failed the real acceptance check with HTTP 404 before implementation. The new migration was applied to the actual database, and all **9 subscription workflows passed** against the production frontend, real engine/database/worker and LiveKit: activation, operator authorization, duplicate-payment/concurrent-retry protection, stale-edit rejection, calendar/numeric validation, future activation, expiry with established-call disconnection and native-event filtering, renewal with retained documents/independent suspension, and yearly pricing/cancellation in the browser. Month-end, leap-year and exact grace boundaries are checked using the real term calculations without changing the application clock.

GPT-6 Astra found two API validation defects during review: decimal strings were parsed with Ruby's automatic base selection, and impossible dates were normalized. Both were fixed and exercised through the actual API. The final focused review reported no remaining concrete subscription finding. A registered, enabled cron schedule and actual queued worker cleanup were verified; this does not prove a one-minute disconnection guarantee during worker or SFU outages.

Collection is manual. No payment gateway, automatic card debit, tax invoice, renewal email or public deployment was exercised or implemented by this increment. The subscription record and access enforcement are real; obtaining payment remains an operator action.

## Business communications verified on 2026-10-17

The new business APIs use the actual Chatwoot/Rails engine, PostgreSQL, Redis and ActiveStorage. Meetings use the pinned LiveKit 1.9.0 server. Production features do not use simulated services or seeded customer data. Automated tests create isolated temporary businesses and deterministic browser camera/microphone inputs.

| Check | Result and scope |
| --- | --- |
| TypeScript and production frontend | Typecheck and Next.js production build passed. |
| Unit/configuration checks | **26 passed**, including fixed API allowlists, existing session/stream protections, reloading changed worker code when Rails was stopped, and production meeting preparation. Invalid addresses/certificates fail before configuration is written; valid certificate bytes and private file permissions are preserved; repeated preparation refuses overwrite. |
| Real business API acceptance | **9 workflows passed**: operator-only provisioning and retry deduplication, packages, employee invitations, tenant/private-channel isolation, real messages/replies/search, protected file bytes, existing-identity protection, concurrent seat/storage enforcement and branding/last-administrator protection. |
| Real browser and meeting acceptance | **7 workflows passed**: two-employee messaging and file downloads, persistent reply drafts, private/standalone views, mobile controls, bidirectional camera/microphone media, a second screen-share track, and disconnection after channel membership removal. Chromium supplied test media; WebRTC and the SFU were real. |
| Browser onboarding | **3 workflows passed**: operator creates a standalone business and changes quotas; a new administrator accepts the invitation, signs in and saves a logo; a separately authenticated employee joins with limited permissions. |
| Customer-inbox regression suite | **23 passed** against the production Next build and real engine, including website/API messages, notes and attachments, automations, tenant isolation, MFA, stream revocation, failed-send recovery and complete 12/20 MiB files. Browser sign-in tests honor the engine's Retry-After limit. |
| Native lifecycle/realtime acceptance | **4 workflows passed**: existing WebSocket subscriptions stop delivering after package change/suspension; missing SFU rooms reconcile; native membership reassignment is rejected and removal ends calls; native suspension ends calls. Includes rejecting an unexpired token after room deletion and fresh direct conversations after rehire. |
| TLS routing | Real HAProxy/Caddy containers passed web and TURN SNI routing, original visitor-IP preservation, console/health restrictions and private SFU administration. This used a local test certificate, not public certificate issuance or an internet TURN/media path. |
| Recovery | An isolated empty-volume restore matched all ten business tables, native attachment bytes, a protected business document's SHA-256, Redis and repeat-restore protection. Temporary restore volumes were removed. |
| Startup and syntax | Actual setup applied the business migrations, loaded the mounted extension and retained the owner. A subsequent setup preserved the running engine container. A newly bootstrapped owner received Business capabilities; repeating bootstrap preserved an explicitly selected Team package. Base/compact/production Compose configuration and Node/Bash/Ruby syntax passed; frontend, engine and meeting health passed. |
| Independent review | GPT-6 Astra reviewed tenant boundaries, native administrative paths, realtime delivery, media revocation and the final startup changes. The final worker-reload finding was fixed and its regression passed; no outstanding finding remained in that review. |

The production-runtime fault-injection suite also passed for the existing inbox send/upload regressions. It deliberately controls upstream failures; these test fixtures are not product backend implementations.

Deployment acceptance remains necessary for the intended VPS, public DNS/trusted certificates, relay-only TURN/TLS443 calls from different physical networks, real devices, off-host recovery, production SMTP/providers and measured concurrent-call capacity. The original multi-layer engine image and full production Compose topology were not deployed in this VFS cloud; the preserved flattened images described below were used. Package assignment is real and operator-managed; automatic billing is not implemented.

## PR #1 fixes verified on 2026-10-13

These checks apply to the fixes after PR head `45910915`, on Linux with Node.js 24.19.0, Next.js 16.4.0, iron-session 9.0.1 and Chromium. They establish local acceptance for the reviewed changes, not approval for live customer traffic.

| Check | Result and scope |
| --- | --- |
| Locked dependencies, TypeScript and production build | `npm ci`, `npm run typecheck` and `npm run build` passed. |
| Unit and isolated regression tests | **21 passed**. Tests execute the actual session and stream modules with controlled framework/network boundaries. They cover late workspace/logout renewal responses, activity binding and absolute expiry, concurrent stream capacity, cancellation/setup cleanup, and migration/setup image selection. |
| Production browser regressions | `npm run test:runtime` passed against the built Next server and a deterministic backend fixture. Repeated text and older attachments cannot confirm a rejected new send; drafts/files remain. 1, 12 and 20 MiB uploads arrive intact; 20 MiB + 1 byte of files and a chunked 22 MiB request return 413. |
| Caddy request path | The same runtime checks passed through Caddy 2.10.2 with the committed request-body/security/compression configuration, using loopback HTTP hosts and test upstreams. Public HTTPS/certificates were not exercised. |
| Real-engine browser suite | **23 passed**, using the production Next build, real Rails/Sidekiq, PostgreSQL and Redis. Includes actual widget/API messages, tenant and note isolation, automations, MFA, revocation/logout, unsigned provider rejection, exact JSON/multipart send identifiers after a lost acknowledgement, and complete 12/20 MiB attachment storage/download. |
| Migration and repeat setup | The configured engine completed `db:chatwoot_prepare`. A repeated setup retained the running engine container, private configuration and owner identity. Isolated Docker-command tests distinguish outdated and matching running images; the original PR fails the outdated-image cases. This is not a major-version database upgrade rehearsal. |
| Local recovery drill | Passed with a disposable Compose project: database counts/blob identity, attachment SHA-256, Redis state and repeat-restore protection. Temporary volumes/probes were removed and a clean snapshot was retained. This did not test an off-host backup destination. |
| Configuration and helper syntax | Base, compact and production Compose validation, Caddy validation, Node/shell helper syntax and Ruby initializer syntax passed. |
| Independent review | GPT-6 Astra reviewed the fixes and final setup/test changes; no remaining actionable findings were reported. |

The original PR's failed-send and upload defects were reproduced in its production build before fixing them. The new session, stream and migration regressions also failed against the original modules/scripts and pass with the fixes. Provider delivery and exactly-once sending are not inferred from a message being stored.

This cloud uses Docker VFS. The standard engine pull exhausted the available disk. For the integration run, the filesystems of the pinned Chatwoot 4.18.0 and pgvector/PostgreSQL 16 images were exported with checksum-verified `crane` 0.20.6 and loaded as local single-layer images with their runtime configuration preserved. Private Compose overrides selected those images; production image references in the repository were unchanged. Snapshots, previous image archives and private configuration were preserved. This verifies the pinned software's local behavior, not deployment of the original multi-layer images or the production Compose topology.

The final application Docker image build, public deployment/TLS, live-provider delivery, production SMTP, off-host restore and realistic production load remain unverified in this run. GitHub Actions results were not available through the current GitHub API. SIGTERM draining of live streams was reviewed but was not rerun as a fault-injection test.

## Earlier local release evidence

- The final Next.js production build completed successfully. Its standalone server passed frontend/backend health, unauthenticated private-page redirection, the branded login page, a real owner sign-in, a scoped inbox read, and logout. This was a local HTTP smoke check, not a deployment.
- TypeScript checking and **4 unit tests** completed successfully. Every Node helper passed syntax checking; the Bash startup/install scripts and compact process supervisor passed shell syntax checks.
- The real-backend browser suite completed with **19 passed in 2.7 minutes**, exit 0. It exercises website and API customer messaging, replies and file bytes, private-note/attachment exclusion, widget reload persistence, mobile layout and controls, assignment/priority, pending-bot handoff, separate draft modes across navigation/reload, pending sends across navigation, long history and unread counts, catch-up after disconnected and navigation bursts, contact history, protected pending forms, new website channels, saved replies, real automation, reports, bot/webhook/inbox access settings, MFA, same-user workspace event isolation, membership revocation, draft cleanup, and logout.
- The source ZIP was extracted into a fresh folder without dependencies, generated builds, or private configuration. `npm ci`, TypeScript checking, and all 4 unit tests passed there. Archive entries were checked against the included SHA-256 manifest and scanned for the installation’s known private values. This validates source packaging; a fresh full Docker installation on macOS/Windows is not claimed.
- Tests ran against the actual local messaging engine and honored its authentication limits. Their synthetic accounts and customer records were removed; the retained primary workspace has zero customer contacts, conversations, and attachment blobs.
- The new reply/private-draft and shared-user event-isolation tests failed against the earlier implementation and passed after the fixes. The initial assignment regression had an ambiguous locator; it now asserts the correct native `me` queue. The first expanded run passed 18/19 because another test locator matched both preview and message text. That selector was scoped to the message pane before the successful complete run; no behavior assertion was removed.
- Desktop and mobile screenshots were inspected. The desktop sidebar fits a 720-pixel-high window, small screens expose account and conversation controls, and the mobile test checks for horizontal overflow. GPT-6 Astra performed fresh reviews; its concrete findings were addressed, with no remaining finding in the final focused history review.
- The provider-file helper previously passed seven synthetic secret round trips through the actual Docker Compose runtime, public application-ID parsing through Next, preservation of existing whitespace/export assignments, and invalid application-ID rejection. No actual secrets were printed. This helper was unchanged during the local release fixes.

The initial full cloud install script completed locked installation, setup, type checking, unit tests, build, and snapshot. Local startup and recovery evidence for the revised helpers appears below. The earlier standalone Docker image/non-root health check and Caddy validation predate these local UI fixes; they are preparation evidence, not a new production release or public deployment.

## Load measurements

Two earlier local runs, before the compact-runtime and inbox-reliability changes, established 2,000 native WebSocket subscriptions without observed disconnects. The application run additionally used one authenticated server-sent-events relay, for 2,001 native connections. Each run sent 30 sequential operations in one conversation while other customers stayed connected but idle. This does **not** simulate 2,000 agents or simultaneous messages. Both fixture accounts were removed after the runs.

| Operation | Native p50 / p95 / max, ms | App relay p50 / p95 / max, ms |
| --- | --- | --- |
| Incoming message | 47.64 / 132.45 / 188.78 | 51.26 / 141.90 / 182.98 |
| Outgoing message | 66.39 / 201.19 / 229.08 | 77.39 / 180.96 / 416.63 |
| Customer typing | 85.41 / 252.47 / 312.69 | 61.46 / 130.39 / 176.71 |
| Agent typing | 89.62 / 299.77 / 309.64 | 85.97 / 251.07 / 297.20 |
| Agent presence | 16.45 / 45.61 / 66.61 | 25.84 / 56.70 / 305.00 |

The requirement that every response stay below 100 ms **failed**. Successful diagnostic runs demonstrate delivery and collect measurements; they do not establish that latency guarantee. `OG_LOAD_ENFORCE_LATENCY=1 npm run test:load` enables failure on that threshold. Raw credential-free measurements are in [native results](benchmark-native.json) and [application relay results](benchmark-app-stream.json). CPU/memory sizing and any alternative cable/scaling work require another measured run.

A final smoke check of the revised relay and compact runtime delivered all five event types across 21 real connections (including one authenticated app stream), with five samples each and no observed disconnects. It is functional smoke coverage, not a replacement for the earlier 2,000-connection measurements; it also did not meet the strict all-samples-below-100-ms target. See [current local smoke results](realtime-local-smoke.json).

## Local startup and recovery

The following startup/recovery evidence predates PR #1. The PR validation above describes the additional VFS storage workaround required for its engine image. Docker uses the VFS storage driver, which copies the full Rails image for each container. The compact overlay supervises Rails and Sidekiq in one container; setup reuses it for migration/provisioning only after its image ID matches the configured release and archives attachments with a small helper image. About 1.9 GiB remained free after the checks. Both processes have a 45-second Compose shutdown grace period; production retains separate services.

- `npm run local` launched the frontend and healthy messaging services. A direct SIGINT stopped the frontend while the backend remained available. Repeating startup retained the same healthy backend container and owner identity. `npm run local:status` passed, checking actual required-container states as well as HTTP health.
- `npm run test:recovery` completed against a separate randomly named Compose project. It created a native ActiveStorage blob and a Redis probe, took a consistent snapshot, restored empty volumes, compared database record counts and blob identity, verified the attachment SHA-256, and checked restored Redis data. A second restore retained the existing database. The temporary project/volumes, blob, and probe were removed, followed by a clean source snapshot.
- Interrupted-restore markers correctly blocked setup, service startup, snapshot creation, and restore. The credential-display command refused redirected output without printing credentials.
- Native asynchronous test-account deletion left orphaned synthetic contacts in earlier runs. Fixture cleanup now destroys contacts while their parent account exists and avoids obsolete asynchronous agent cleanup. The identified old test-only contacts were removed; the primary workspace contains no seeded customer conversations.

Publication and restoration in a fresh cloud task remain unverified. Local recovery is evidence for the database/storage/Redis workflow, not proof that the platform has published or restored its filesystem snapshot.

## External and product limits

- Public targets are `og.growcdx.com` and the proposed engine/callback hostname `messages.og.growcdx.com`. Hosting/server selection, DNS, public HTTPS, SMTP, and authorized channel credentials remain necessary. DNS lookups here failed and did not establish the domains' actual records. No DNS change, server deployment, or external-channel activation was performed.
- Website/custom-API messaging was exercised. WhatsApp, Telegram, Facebook, Instagram, email, Twilio SMS, and LINE have real setup flows but delivery remains unverified without provider credentials. The current runtime proxy denied a Telegram connectivity probe; provider domains were added to the saved draft, which does not change runtime access until the configuration is applied/published.
- Strict Safari storage behavior, custom Shadow DOM isolation, database-lock response guarantees, crash recovery, and the research brief's full fault-tolerance requirements are not verified. The native widget uses an iframe. Ordinary Chatwoot account webhooks are signed but are not automatically retried; application logout/account changes close its live relay, and cross-instance/native membership revocation is bounded by profile revalidation rather than guaranteed instantaneous.
- Native business chat, protected documents and WebRTC meetings are implemented in this release. Standalone visual bot building, trained RAG, automatic billing and the remainder of the broader research brief are not implemented as independent OmniGrow products. Native engine administration and an external bot endpoint are available; see [architecture and scope](ARCHITECTURE.md).

The repository includes the source, infrastructure helpers, tests, and documentation for the local release. Private configuration, credentials, snapshots, and test output are ignored by Git and excluded from Docker build context. Each fresh installation generates its own private credentials and encryption keys.
