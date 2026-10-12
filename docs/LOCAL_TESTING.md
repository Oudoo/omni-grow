# Local testing guide

## Start

1. Install **Node.js 24 LTS** and **Docker Engine/Desktop with Compose v2**, using Linux containers. Start Docker. Allow roughly 8 GB RAM and 20 GB free disk for images, dependencies, builds, and data. This release was tested on Linux; native macOS/Windows host setup is not independently verified.
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
5. Open a second terminal in the same source folder and run `npm run local:credentials`. It prints your generated owner email and password only in an interactive terminal. Those values also live in `.local/bootstrap-credentials.json`. If you later change the password, use your new one.

No hosting account, domain, provider token, or paid AI API is needed for website chat and local inbox testing.

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
- Keep `.env.local`, `.local/engine.env`, `.local/bootstrap-state.json`, `.local/bootstrap-credentials.json`, `.local/runtime.json`, and snapshots private. Git and the source ZIP exclude them; each fresh installation generates its own credentials.
- `npm run snapshot` pauses messaging briefly and saves database, attachment, and Redis state under `.local/snapshot`. Store a copy with the private files somewhere separate from the computer. See [recovery instructions](DEPLOYMENT.md).

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Docker unavailable | Start Docker Desktop/Engine and confirm `docker info` works. |
| Port 3000 or 3001 in use | Stop your previous OmniGrow process or the other program using that port before launching. |
| Messaging unavailable | Run `npm run local:status`; inspect `docker compose logs --tail=80 rails redis postgres`. Redact credentials before sharing logs. |
| Worker missing on a normal Docker installation | Run `npm run services:up`. Compact VFS mode intentionally runs the worker inside the Rails container. |
| Low disk space | Free space outside your data volumes. Setup selects compact mode automatically for Docker VFS and records it in `.local/runtime.json`; you can set its `compact` value to `true` locally, then rerun setup. |
| Interrupted restore marker | Do not remove it blindly. Inspect database, attachments, and Redis as described in the recovery guide before resuming. |
| Repeated sign-ins return 429 | Honor the native rate limit and wait for its retry period. |
| Channel receives no external messages | Website chat works locally. Social/SMS webhooks require a public HTTPS endpoint and authorized provider configuration. |

## Optional automated checks

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

The browser suite uses the real local backend, creates its own test accounts, and removes their records afterward. Repeated runs honor native login throttling and can wait up to five minutes. Linux may require Playwright’s documented browser OS dependencies. `PLAYWRIGHT_CHROMIUM_PATH` can select an existing Chromium executable. Run `npm run build` when the dev server is stopped to verify the production bundle. `npm run test:recovery` verifies an attachment-bearing snapshot in disposable local volumes; it briefly pauses messaging twice, so run it separately from the browser suite. See [validation evidence and limits](VALIDATION.md).
