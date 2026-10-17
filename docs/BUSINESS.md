# Businesses and team communications

OmniGrow includes native internal channels, direct messages, shared documents and live meetings. Data is stored by the real Rails/PostgreSQL engine; calls use the self-hosted LiveKit service. There are no seeded teammates, simulated messages or shared public meeting rooms.

## Packages and onboarding

| Operator-assigned package | Customer inbox | Team chat, documents, meetings | Branding and employees |
| --- | --- | --- | --- |
| Customer inbox | Yes | No | Yes |
| Team communications | No | Yes | Yes |
| Business | Yes | Yes | Yes |

The installation owner normally has the SuperAdmin role. Sign in and open **Businesses → Create business**. Enter the company name, first administrator, package, employee-seat allowance and document-storage allowance. Creation is atomic and retries use the same creation ID. Only the installation operator can assign packages, quotas, subscription terms or suspension; a business administrator cannot change their package or create other tenants.

Copy the generated administrator invitation and deliver it privately to that person. Links expire after seven days, are single-use, and reserve a seat. Only a SHA-256 digest is stored. An invitation is carried in the URL fragment, which is not sent in HTTP request URLs. If the creation response was lost, the existing business is returned; use **Invite administrator** to issue a replacement link. The previous unused link is revoked.

An invited new employee chooses their own password. Existing users must sign in as the invited email address; an invitation cannot change their global password or MFA. A person can belong to several businesses and switch through the account menu. A person removed from their last business can still sign in to accept a new invitation, but has no workspace access until acceptance.

Inside each company, **Business settings** provides:

- Company name, description, HTTPS website, brand color and a PNG/JPEG/WebP logo, up to 2 MiB.
- Employee invitations, pending-invitation revocation, employee/admin roles and removal.
- Seat/storage usage and a recent audit trail. At least one administrator must remain.
- A read-only subscription summary for company administrators, including the agreed price, paid-through date and grace period.

The initial installation starts with Business capabilities for local testing. Existing package assignments survive repeated setup. Each newly provisioned customer gets exactly the package selected by the operator.

## Hosted leases and subscriptions

Your VPS can serve several businesses with independent packages and payment terms. Open **Businesses → Manage subscription** for the business. Existing and new businesses start with open-ended access, so paid terms are optional and upgrades do not unexpectedly expire current customers.

1. Choose **Activate or replace a paid term**, monthly or yearly, the start date, agreed price/currency, and 0–30 grace days. Enter a unique payment or invoice reference. A future start date restricts access until that date; replacing a term replaces its remaining paid time.
2. After receiving payment, choose **Record payment and renew one period**. Active, scheduled and grace-period subscriptions extend their original calendar term. Expired or cancelled subscriptions start a fresh period at renewal time. A January 31 monthly anchor renews through February's last day and then March 31; yearly leap-day terms preserve the original anchor.
3. Choose **End access now** to cancel access, or **Grant open-ended access** for a perpetual/contract arrangement. Each change requires a reference and appears in the operator's history. These actions do not issue refunds.

Prices are stored in integer minor units. Supported currencies are USD, EUR, GBP, EGP, AED, SAR, INR, CAD, AUD, JPY, KWD, BHD and OMR, with their correct zero/two/three decimal places. Employees do not receive financial terms; business administrators can read their price but cannot edit it. Only the operator sees payment references and change history. This is manual payment administration: the app does not collect cards, generate tax invoices, email renewal notices or automatically debit customers. Those require a selected payment provider and accounting/messaging integration.

Each operation has an idempotency ID and expected version. Concurrent retries cannot add an extra period, reused payment references are rejected case-insensitively within that business, and an old edit cannot overwrite newer terms. Review the current history before entering a new reference after an uncertain response.

At expiry, employee requests, private document downloads and live-event delivery are denied by the backend. Employees can still sign in and read their activation status. Stored messages/documents remain and become accessible after renewal; renewal does not lift a separate account suspension. External customer widgets and inbound provider callbacks continue accepting messages; this subscription controls employee service access, not provider accounts or data deletion. Operators can still manage subscriptions if their own business term is inactive.

Active meetings are ended by the `omnigrow_subscription_expiry` job, scheduled once per minute on Sidekiq's `critical` queue. Request checks use the clock directly; established media needs the worker and SFU to be available for cleanup. An admission token already issued can remain valid for up to 60 seconds. Monitor the queue and cleanup errors: worker/SFU outages can delay disconnection. Explicit cancellation ends existing meetings before confirming success.

## Daily use

Open **Team chat** and create a public channel for everyone in the current business, a private channel for selected employees, or a direct conversation with one teammate. Channel creators and participating company administrators can manage the channel. Public means company-wide, never internet-public. Administrators do not automatically see private channels they have not joined.

Messages persist across reloads. The workspace supports history, channel search, replies, author/admin editing and deletion, unread counts, and drafts scoped to the user, business and conversation. Uncertain sends retain their unique request ID so retrying cannot duplicate a stored message. Attached file bytes must be reselected after a browser reload; the draft remembers filenames and tells the employee what is missing.

Attach up to five files per message, totaling at most 20 MiB, or use **Shared documents → Upload document** for a single file up to 20 MiB. Files inherit their channel's visibility. Every download checks current tenant and channel membership; the API does not reveal reusable storage keys, signed blob URLs or public document links. Concurrent uploads and invitations are checked under the business lock so they cannot overrun their allowances. Deleting a message removes its attachments and retains a deletion marker. Archiving a channel retains history and files and prevents new messages, uploads or meetings.

Removing an employee revokes current REST and realtime access. Their private-channel memberships are removed. Existing direct conversations become archived for retained participants; re-inviting that person starts fresh direct conversations and does not restore their old private history. Public company-channel history is available to current employees.

## Meetings

Choose **Meet** in a channel or direct conversation. Check camera/microphone choices, then join. Calls support microphone, camera, screen sharing, participant tiles, temporary in-call chat, leaving, and host/admin **End for everyone**. Use the persistent channel for records and documents that must survive the call. Current limits are 50 participants per room and ten active meetings per business; these limits are not a measured VPS capacity guarantee.

Admission is checked against current tenant, plan, membership and channel visibility. Tokens expire after 60 seconds for admission; expiry alone does not disconnect an established call. Ending a meeting deletes its unique SFU room, and automatic room creation is disabled. An old token therefore cannot recreate the room. Removing a channel participant or employee ends affected meetings before removal; suspending a business or removing its team package also ends its active meetings. Remaining employees can start a new meeting. These rules also cover native administrative-console membership removal and account suspension. Reassigning an existing employee record to another person/business is rejected; use remove and invite.

## Local acceptance

Run `npm ci` and `npm run local`, then open `http://localhost:3000`. Retrieve the initial credentials privately with `npm run local:credentials`. Use two different browser profiles for two employees. Create two businesses and check branding, invitations, private/public channels, cross-business file denial, file download bytes, chat after reload, call controls, screen sharing, removal and suspension. Cameras and microphones require localhost on the same computer or HTTPS. A plain HTTP Wi-Fi IP is insufficient for browser media permissions; use the HTTPS VPS configuration for other devices.

`npm run test:business` runs real API, browser/media, lifecycle and TLS-router checks against the default local installation and cleans up its isolated records. A running frontend, engine, LiveKit, Docker, OpenSSL and Playwright Chromium are required. The suite honors native sign-in rate limits and can wait up to five minutes. The browser uses deterministic test cameras/microphones through actual WebRTC/SFU connections. TLS-router checks use a local test certificate and prove routing/client-IP behavior, not public certificate issuance or internet TURN connectivity. Results in `.local/business-*-results.json` contain no credentials; `.local/business-test-state.json` is private and is removed by the complete suite.

`npm run test:subscriptions` uses the same real services to verify operator/customer permissions, calendar boundaries, payment retry deduplication, scheduled access, worker-driven meeting expiry, retained documents after renewal and the operator/customer browser flow. Its isolated businesses are removed afterward; the credential-free result is `.local/subscription-results.json`.

## Storage, upgrades and boundaries

Business tables use an independent `og_schema_migrations` ledger and composite tenant foreign keys. `npm run setup` and `npm run migrate` apply upstream and extension migrations. Setup detects mounted Ruby changes and restarts the engine processes so an unchanged upstream image cannot keep old extension code in memory.

The database and existing ActiveStorage volume contain business records, logos and documents. The standard snapshot/restore procedure covers them. Keep the matching private environment files, LiveKit configuration and TURN certificate material in encrypted backups. Live meeting connections are transient and must be re-established after a service restart or restore. Reconciliation clears stale meeting rows when their SFU room no longer exists.

See [deployment](DEPLOYMENT.md) for HTTPS, TURN, firewall and certificate renewal. Public DNS/TLS, real physical devices on different networks, outbound provider integrations and VPS capacity must be tested on the actual deployment before selling production availability commitments.
