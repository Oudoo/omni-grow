# Deploy with Coolify

`compose.coolify.yaml` runs the full stack (web app, messaging engine, worker,
PostgreSQL and Redis) as one Coolify resource. Coolify's proxy provides HTTPS
certificates. Every secret except the first owner's login is generated on the
server the first time PostgreSQL starts, and kept in the `og-secrets` volume.

The defaults deploy **Abo Teeg Pharmacy**:

| Service | Address | What it is |
| --- | --- | --- |
| `app` | `https://og.aboteegpharmacy.com` | Staff inbox, installable as an app (PWA) |
| `rails` | `https://messages.og.aboteegpharmacy.com` | Messaging engine, website widget, provider webhooks |

## 1. DNS

Point both names at the server's public IPv4 address with `A` records
(`og` and `messages.og` for `aboteegpharmacy.com`, leaving the bare domain free
for the main website). Wait until they resolve before
deploying, otherwise certificate issuance fails and must be retried.

## 2. Create the resource

1. In Coolify open your project → **+ New** → **Public Repository**.
2. Repository URL: `https://github.com/Oudoo/omni-grow`, and choose the branch.
3. **Build Pack:** `Docker Compose`. **Base Directory:** `/`.
   **Docker Compose Location:** `/compose.coolify.yaml`. Continue.
4. Under **Domains**, set:
   - `app` → `https://og.aboteegpharmacy.com:3000`
   - `rails` → `https://messages.og.aboteegpharmacy.com:3000`

   The `:3000` tells the proxy which container port to use; visitors still use
   the plain `https://` address.
5. Open **Environment Variables** and set:
   - `OG_OWNER_EMAIL`: the first administrator's email address.
   - `OG_OWNER_PASSWORD`: at least 6 characters, with an uppercase letter, a
     lowercase letter, a number and a special character. Mark it as a secret.

   Leave the other variables at their defaults unless you change addresses
   (`OG_APP_URL`, `OG_MESSAGING_URL`) or names (`OG_WORKSPACE_NAME`,
   `OG_OWNER_NAME`, `OG_BRAND`). Changing `OG_MESSAGING_URL` or `OG_BRAND`
   requires a redeploy because they are built into the app.
6. **Deploy.** The first deployment builds four images and prepares the
   database; allow 10–15 minutes. `rails` becomes healthy after the database
   is ready, then `worker` and `app` start.

The owner credentials are used only on the first successful start. Change the
password later from the messaging administration's profile page; redeploying
does not reset it.

## 3. Check it

- `https://og.aboteegpharmacy.com/api/health` returns `{"status":"ok"}`.
- Sign in at `https://og.aboteegpharmacy.com` with the owner credentials.
- **Channels → Connect website**, then **Install widget → Test real widget**
  sends a real customer message to the shared inbox.

## Install the app on staff devices

The site is an installable Progressive Web App:

- **Android (Chrome):** open the address, then tap **Install** on the sign-in
  screen or **Install app** in the menu, or use the browser menu → *Install app*.
- **iPhone / iPad (Safari):** tap **Share** → **Add to Home Screen** → **Add**.
- **Windows / macOS (Chrome or Edge):** click the install icon in the address
  bar or **Install app** in the sidebar.

The app opens in its own window with the pharmacy icon. Conversations are never
stored offline; without a connection it shows an offline screen.

## Operations

- **Logs:** each service's logs are in the Coolify resource. A failed first
  start that says *Set OG_OWNER_EMAIL and OG_OWNER_PASSWORD* means the
  variables are missing. Set them and redeploy.
- **Data:** the `postgres`, `storage`, `redis` and `og-secrets` volumes hold
  everything. Never delete `og-secrets` while keeping `postgres`: the database
  password and encryption keys live there.
- **Backups:** enable Coolify's scheduled backups or Hostinger VPS snapshots,
  and copy `og-secrets` with them.
- **Email:** invitations and password resets need SMTP. Add the `SMTP_*` and
  `MAILER_SENDER_EMAIL` variables listed in [channels](CHANNELS.md) to the
  `x-engine-env` block before inviting staff by email; until then, create
  agents with passwords in the messaging administration.
- **Client IPs:** `TRUST_PROXY` stays `false` so sign-in throttling cannot be
  bypassed with a forged header. Enable it only after confirming the proxy
  overwrites `X-Real-IP`.
