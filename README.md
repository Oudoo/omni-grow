# OmniGrow · OG

A multi-tenant customer inbox and business communications workspace built with Next.js/TypeScript, a real self-hosted Chatwoot/Rails engine and LiveKit meetings. Each business has its own branding, administrators, employees, channels and documents. Each external customer channel still requires authorization from its provider.

The workspace includes a responsive inbox, channel setup, contacts, reports, saved replies, welcome automation, bot assignment, and team/webhook settings. Messages, rules, contacts, and settings persist in PostgreSQL. ActionCable/Redis delivers live updates; Sidekiq performs background work. The application does not seed customer conversations or fabricate report data.

**Businesses** lets the installation operator provision customers with standalone **Team communications**, **Customer inbox**, or the combined **Business** package. Team communications includes private/public channels, direct messages, persistent document sharing and real audio/video/screen-sharing meetings. See the [business onboarding and testing guide](docs/BUSINESS.md).

For a VPS-hosted service, each business can have a monthly or yearly subscription, or open-ended access. The operator records payments, renews terms, sets prices and grace periods, and ends access. Expired terms restrict employee access while retaining company data. Payment collection is manual; automatic card billing requires a payment-provider integration.

## Test locally

Install Node.js 24 LTS, Git, and Docker Engine/Desktop with Compose v2. Start Docker, then clone the repository and launch the app:

```sh
git clone https://github.com/Oudoo/omni-grow.git
cd omni-grow
npm ci
npm run local
```

If you downloaded a source ZIP instead, extract it and run the two npm commands from its folder.

Setup generates private random credentials and encryption keys once, prepares the real database, and starts the messaging services. It preserves existing configuration and account data on repeat runs. In a second terminal, run `npm run local:credentials` to display your initial login privately. It refuses redirected output. The same details are in `.local/bootstrap-credentials.json`; never commit or paste them into chat, and delete the file after changing the owner password. The app listens on port 3000; the engine is bound to loopback port 3001 locally only. PostgreSQL and Redis have no published ports. The cloud onboarding UI does not provide a web preview.

Sign in, open **Channels → Connect website**, configure an inbox, and open **Install widget → Test real widget**. This exercises the same real widget used on customer websites. This cloud workspace has a Website Support inbox already; a fresh local installation starts without channels. The `/demo?token=…` page embeds the native widget using an inbox's public website token.

Follow the [local testing guide](docs/LOCAL_TESTING.md) for a ten-minute walkthrough, stopping/restarting, credentials, and troubleshooting. `npm run local:status` checks the app and every required container. `npm run services:down` stops messaging while preserving data. Local VFS installations automatically use a compact supervised web/worker container; production keeps them separate.

## Develop

Use the existing checkout; each cloud task is isolated and needs no additional worktree. Chromium is needed only for browser tests: use your installed Chromium or run `npx playwright install chromium`.

```sh
npm run typecheck
npm test
npm run test:e2e
npm run test:business
npm run test:subscriptions
npm run build
npm run test:load
```

Browser tests create isolated accounts against the running database, exercise actual channel and UI flows, and remove their records afterward. They honor native login throttles, so a repeated run can wait up to five minutes. Test credentials, session files, logs, and reports remain ignored. Load testing creates 2,000 real WebSocket subscriptions in an isolated account and records measured latency; it never targets a remote service.

See [validation](docs/VALIDATION.md), [channel configuration](docs/CHANNELS.md), [deployment and recovery](docs/DEPLOYMENT.md), [architecture and scope](docs/ARCHITECTURE.md), and the [production readiness status](docs/PRODUCTION_READINESS.md). GitHub Actions run typecheck, unit tests, the production build, configuration validation and an image build on every push; the browser suite against the real engine runs nightly and on demand.

## Reuse this cloud environment

`bash scripts/cloud-install.sh` installs locked dependencies, sets up services, checks the app, and saves a consistent database/storage/Redis snapshot under `.local/snapshot`. `bash scripts/cloud-start.sh` restores that snapshot only into empty volumes when needed, starts the services, and verifies frontend/backend health. Live processes are not assumed to survive publication. Retain `.env`, `.env.local`, `.local/engine.env`, `.local/livekit.yaml`, `.local/bootstrap-state.json`, `.local/bootstrap-credentials.json`, `.local/runtime.json`, and `.local/snapshot` privately together.

Docker VFS previously exhausted this instance’s root disk by copying the Rails image for every helper. Compact startup reuses the running service and small archive helpers; repeated startup now succeeds. See [validation](docs/VALIDATION.md) for current recovery and acceptance evidence. Setup/start instructions are saved to the cloud environment draft separately from repository files. Review and save the draft in environment settings, then publish when the product offers publication. Validation in this machine does not prove restoration in a newly published task.

## Current delivery boundary

This release is intended for local acceptance of the customer inbox and business communications product. Website/API messaging, tenant isolation, private documents and real team media are exercised against local services. External WhatsApp, Telegram, email, Facebook, Instagram, SMS, and LINE delivery still requires provider authorization. No public deployment has been started. HTTPS/physical-device/TURN acceptance and capacity checks belong on the actual VPS. The research brief's strict latency, Safari storage, and database fault-tolerance criteria require further engineering and validation; see the measured evidence rather than assuming those guarantees.

Source, setup scripts, tests, and documentation are maintained in [Oudoo/omni-grow](https://github.com/Oudoo/omni-grow). Private credentials, customer data, snapshots, dependencies, and generated builds are excluded from Git. See [third-party notices](THIRD_PARTY_NOTICES.md) for upstream attribution and license boundaries.
