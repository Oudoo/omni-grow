# Local testing guide

## Start

1. Install **Node.js 24 LTS** and **Docker Engine/Desktop with Compose 2.24.4 or newer**, using Linux containers. Start Docker. Allow roughly 8 GB RAM and 20 GB free disk for local images, dependencies, builds, and data; production sizing starts higher. This release was tested on Linux; native macOS/Windows host setup is not independently verified.
2. Clone the repository with Git into a normal writable folder:

   ```sh
   git clone https://github.com/Oudoo/omni-grow.git
   cd omni-grow
   ```

   Alternatively, download and extract the source ZIP. From the source folder, run:

   ```sh
   npm ci
   npm run local
   ```

3. Wait for the messaging service and Next.js ready messages. The first launch downloads pinned backend images and initializes PostgreSQL; it can take several minutes.
4. On your own computer, enter `http://localhost:3000` in your browser. Use `localhost` consistently because the login origin is bound to it. This cloud onboarding UI does not provide a browser preview.
5. Open a second terminal in the same source folder and run `npm run local:credentials`. It prints your generated owner email and password only in an interactive terminal. Those values also live in `.local/bootstrap-credentials.json`. After changing the password, delete that file; repeat runs identify the owner through `.local/bootstrap-state.json` and never reset the password. The owner also opens the engine's installation console at `http://localhost:3001/super_admin` with the same credentials.

No hosting account, domain, provider token, or paid AI API is needed for website chat, internal team communications or local calls on the same computer.

## Try businesses and team communications

Open **Businesses → Create business** as the installation owner. Select **Team communications** for the standalone offering or **Business** for team communications plus the customer inbox. Set the employee and storage allowances, copy the administrator invitation, and open it in a separate browser profile. The invited administrator chooses a password and signs in independently.

In **Business settings**, save the company name, logo and brand color, then invite employees. Each employee accepts their own private invitation. Open **Team chat** to create company/private channels and direct conversations, send messages and documents, and start a meeting. Use two browser profiles to verify camera, microphone, screen sharing and employee permissions. Detailed behavior and limits are in [business communications](BUSINESS.md).

For media testing, `localhost` works on the computer running the app. Other devices need a reachable HTTPS host and the configured media/TURN ports; a plain HTTP Wi-Fi address does not grant browser camera/microphone access. This cloud workspace is not on your Wi-Fi network.

## Try the main workflow

1. Sign in and open **Channels**. Click **Connect website**, name it “Website Support”, enter `http://localhost:3000` as the website URL, and connect. Your owner is assigned inbox access automatically. A fresh installation has no seeded conversations.
2. In the new channel, click **Install widget → Test real widget**. In that new tab, open the chat bubble, start a conversation, and send a message as a customer.
3. Return to **Shared inbox**, open the conversation, and send a reply. The customer tab receives the real reply. Attach a small file and verify it opens from the customer side.
4. Add an **Internal note** with an attachment. It stays in the agent history and does not appear in the customer transcript. Reply and internal-note drafts have separate text and files.
5. Type an unsent draft, switch conversations or sections, and return. Drafts survive navigation. Text survives a same-tab reload for up to eight hours; after reloading, reselect attachments or remove their missing-file entries before sending. Signing out clears local drafts.
6. Assign yourself, choose a priority, add a label, and resolve/reopen the conversation. On smaller screens these controls are under **Conversation details**. Use **Account menu** for workspace selection and sign-out. Pending bot conversations offer **Take over**.
7. Open **Contacts**, edit a customer, and follow an entry in their conversation history. Create a saved reply under **Automations**, then type `/` in a conversation to insert it. Create a welcome rule and start a new customer conversation to see it execute.
8. Open **Reports** to see actual activity. Empty workspaces have empty reports. Bot endpoints, other channel providers, invitations, and outbound webhooks require their respective services and credentials; the local acceptance checks use isolated test accounts.

## Stop, restart, and preserve data

- **Ctrl+C** in the launcher stops the frontend. `npm run services:down` stops messaging containers without deleting their data volumes.
- Run `npm run local` again to resume. Setup preserves existing keys, the owner identity, and customer data. `npm run local:status` checks configuration files, all required container health, the API, and free space.
- Do not run `docker compose down -v` on your installation: that deletes volumes. Do not delete `.local` or regenerate encryption keys to fix a login problem.
- Keep `.env.local`, `.local/engine.env`, `.local/livekit.yaml`, production configuration/certificates, `.local/bootstrap-state.json`, `.local/bootstrap-credentials.json`, `.local/runtime.json`, backups and snapshots private. Git and the source ZIP exclude them; each fresh installation generates its own credentials.
- `npm run backup` saves an online database dump and attachment archive under `.local/backups` without pausing anything. `npm run snapshot` pauses messaging briefly and saves database, attachment, and Redis state under `.local/snapshot`. Store a copy with the private files somewhere separate from the computer. See [recovery instructions](DEPLOYMENT.md).
- The workspace sends a report-only Content Security Policy. Violations appear in the browser console and as `content security policy violation` lines in the Next.js terminal; none are expected in normal use.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Docker unavailable | Start Docker Desktop/Engine and confirm `docker info` works. |
| Port 3000 or 3001 in use | Stop your previous OmniGrow process or the other program using that port before launching. |
| Messaging unavailable | Run `npm run local:status`; inspect `docker compose logs --tail=80 rails redis postgres`. Redact credentials before sharing logs. |
| Worker missing on a normal Docker installation | Run `npm run services:up`. Compact VFS mode intentionally runs the worker inside the Rails container. |
| Low disk space | Free space outside your data volumes or increase disk capacity. Setup selects compact mode for Docker VFS, but VFS also duplicates image layers and may need substantially more than 20 GB. Compact mode alone cannot guarantee that an image pull fits. Prefer Docker’s normal storage driver where supported; the cloud-only verification workaround is documented in [validation](VALIDATION.md). |
| Interrupted restore marker | Do not remove it blindly. Inspect database, attachments, and Redis as described in the recovery guide before resuming. |
| Repeated sign-ins return 429 | The engine allows five sign-in attempts per five minutes per client address; wait for the retry period. |
| "Too many live connections" | At most six live event streams are open per sign-in; close other OmniGrow tabs. |
| Channel receives no external messages | Website chat works locally. Social/SMS webhooks require a public HTTPS endpoint and authorized provider configuration. |

## Optional automated checks

```sh
npm run typecheck
npm test
npx playwright install chromium
# Stop the dev server before building.
npm run build
npm run test:runtime
npm run test:e2e
npm run test:business
```

The production runtime checks use isolated synthetic failures on ports 3300/3301. The browser/business suites use the real local backend, create their own test accounts, and remove their records afterward. The business suite additionally requires the running frontend, LiveKit, Docker and OpenSSL. Start `npm run start` in another terminal after building. Repeated runs honor native login throttling and can wait up to five minutes. Linux may require Playwright’s documented browser OS dependencies. `PLAYWRIGHT_CHROMIUM_PATH` can select an existing Chromium executable. Run `npm run build` when the dev server is stopped to verify the production bundle. `npm run test:recovery` verifies business records and stored attachments in disposable local volumes; it briefly pauses messaging twice, so run it separately from the browser suite. See [validation evidence and limits](VALIDATION.md).
