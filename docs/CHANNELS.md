# Connect actual channels

Every channel uses the same agent workspace. Channel authorization belongs to its account owner and cannot be replaced with the agent's OmniGrow login. Supply credentials in channel settings or private deployment configuration, never in chat or tracked files. Production configuration targets `og.growcdx.com` for the app and `messages.og.growcdx.com` for messaging; hosting access and provider credentials are still needed. DNS could not be established through this environment's resolver.

Inbound authenticity differs per provider in Chatwoot 4.18.0 and is summarized in the table at the end. Where the engine does not verify a callback on its own, OmniGrow adds the control described in that channel's section.

## Website and custom API

In **Channels**, create Website chat, select its agent members, and copy **Install widget** into a site you control. The snippet loads the native SDK from your messaging hostname; allow that host in the site's script/frame/connect policy. The website token is a public inbox identifier, not an agent API token. For authenticated customers, enable native HMAC identity validation and calculate the signature on your own server; never expose its secret in browser code.

The demo uses the real native widget. Chatwoot uses iframe isolation rather than OmniGrow implementing a Shadow DOM widget. Browser tests exercise customer messages, actual agent replies, private-note exclusion, and ordinary Chromium reload/history behavior. They do not establish Safari ITP or cross-domain storage guarantees.

Create an API channel with an HTTPS reply webhook you control; the workspace rejects plain `http://` callback endpoints. Use the engine's public inbox API for customer creation/conversation/message operations. Obtain and keep integration credentials privately through native administration. Webhook and bot receivers must validate the native signature when provided, use idempotency, and monitor failed deliveries. A generic Tiledesk URL is not automatically compatible: implement an adapter for the native event and reply contracts.

## Telegram

Create a bot through BotFather and enter its token in the Telegram connection form. The engine registers a webhook using `FRONTEND_URL`; this must be a publicly reachable HTTPS messaging hostname. The bot token in the webhook path is the only authentication Telegram callbacks carry (the engine does not use Telegram's `secret_token` header), so treat engine request logs and any proxy access logs as sensitive; Caddy access logging stays off. Test an actual Telegram user sending a message, an agent reply, an attachment, and reconnect after token rotation. This has not been exercised without your bot authorization.

## WhatsApp Cloud

Supply the real E.164 business number, Meta phone-number ID, business-account ID, permanent access token, and the **Meta app secret** (Meta app → App settings → Basic). The app secret is stored in the channel's provider configuration and makes the engine verify `X-Hub-Signature-256` on every webhook; without it, Chatwoot 4.18.0 accepts unsigned payloads for manually configured Cloud API channels, which would let anyone who knows the business number inject messages, "sent from the business" echoes and delivery statuses. The workspace never returns the secret to the browser. For a channel created before this field existed, update it once through the API: `PATCH /api/workspace/inboxes/<id>` with the complete `channel.provider_config` (all four values plus `app_secret`); the engine re-validates the credentials with Meta. Also set `WHATSAPP_APP_SECRET` (and `WHATSAPP_APP_ID`) in the engine environment when you use Meta's embedded signup through native administration.

Configure the engine's displayed webhook URL and verification token in your Meta app and subscribe to message events. Business verification, permission review, conversation windows, approved templates, and provider charges are Meta requirements. Validate inbound/outbound delivery and status callbacks with an authorized number before use, and confirm that an unsigned `POST` to the webhook URL is answered with `401`.

## SMS and LINE

For SMS, use a Twilio SMS-capable number, account SID, and auth token. Connecting through the dedicated native Twilio endpoint verifies credentials and changes that number's messaging webhook to the configured public messaging host. The form requires HTTPS before connecting. Chatwoot does not validate Twilio's `X-Twilio-Signature`; OmniGrow mounts `deploy/engine/zz_omnigrow_twilio_signature.rb` into the engine containers, which validates the signature of every `/twilio/callback` and `/twilio/delivery_status` request against the channel's auth token and answers `403` otherwise. Behind Caddy the signed URL is the public `https://` callback, so keep the messaging hostname stable after connecting. Twilio provider charges apply; no number has been modified in this environment.

For LINE, provide your Official Account's Messaging API channel ID, channel secret, and access token. Enable webhooks in LINE Developers and configure `https://messages.og.growcdx.com/webhooks/line/<channel-id>`. The engine validates `X-Line-Signature` and drops unsigned events. Test genuine incoming and outgoing messages. SMS/LINE forms and administrator guards are tested, but no external delivery is claimed without authorization.

## Email and transactional SMTP

The OmniGrow form supports an IMAP mailbox on TLS port 993 and SMTP on STARTTLS port 587 using an app password. OAuth-only mailboxes use native provider setup instead. Invite emails, password recovery, notifications, and website offline-email continuity additionally need transactional SMTP in `.local/engine.env`:

```dotenv
MAILER_SENDER_EMAIL=OmniGrow <support@your-domain>
SMTP_DOMAIN=your-domain
SMTP_ADDRESS=your-mail-server
SMTP_PORT=587
SMTP_USERNAME=your-username
SMTP_PASSWORD=enter-privately
SMTP_AUTHENTICATION=login
SMTP_ENABLE_STARTTLS_AUTO=true
SMTP_OPENSSL_VERIFY_MODE=peer
```

These labels describe required configuration, not working sample credentials. Configure your sender's DNS through your mail provider. If using ActionMailbox inbound forwarding instead of IMAP, configure `MAILER_INBOUND_EMAIL_DOMAIN`, `RAILS_INBOUND_EMAIL_SERVICE`, and its private password according to Chatwoot's provider instructions. Add your actual mail-server destinations to cloud egress settings. Real mailbox receive/reply, invitation delivery, and offline continuity remain unverified without these services.

## Facebook Messenger

Register a Meta app authorized for the needed Page permissions. Set `FB_APP_ID`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, and a supported `FACEBOOK_API_VERSION` privately on the engine. Set the matching `NEXT_PUBLIC_FB_APP_ID` and `NEXT_PUBLIC_FB_API_VERSION` for local Next.js; the production overlay takes public build arguments from `FB_APP_ID`/`FB_API_VERSION` in `.local/production.env`. Rebuild the frontend when public build values change. The app ID is public; the app secret must stay on the engine. The engine verifies Messenger webhook signatures with that secret and rejects unsigned requests.

Configure valid OAuth domains/redirects and the Messenger webhook against the public messaging host. OmniGrow opens the real Facebook SDK authorization, lists pages returned by the native engine, and creates the selected authorized Page inbox. Page tokens never return in the page-selection response. Complete Meta's review and test actual Page messages/replies; no connected Page is claimed here.

## Instagram

Use an Instagram professional account and the supported Instagram Login setup. The native engine configuration names are `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, and `INSTAGRAM_VERIFY_TOKEN`; set the app ID in `.local/app.production.env` too so the Next.js runtime's setup gate reflects actual configuration. Local setup copies securely injected provider variables into private files only when an existing value is absent. Configure the callback `https://messages.og.growcdx.com/instagram/callback` and the native webhook through the provider app. The engine always requires a valid `X-Hub-Signature-256` on Instagram webhooks. OmniGrow delegates authorization/callback completion to the engine and then refreshes the inbox list. The native callback may open the engine's own setup screen, using the same credentials. This flow requires live authorization testing.

## Inbound authenticity summary

| Channel | How the engine authenticates callbacks | OmniGrow addition |
| --- | --- | --- |
| Website widget | Public website token; optional HMAC identity validation; per-IP widget throttles | Enable `hmac_mandatory` for signed-in customers |
| WhatsApp Cloud | `X-Hub-Signature-256`, only when the channel carries an app secret | App secret required in the connect form |
| Facebook Messenger | `X-Hub-Signature` via `FB_APP_SECRET` (fails closed) | none |
| Instagram | `X-Hub-Signature-256` always required | none |
| Telegram | Bot token in the callback path | Keep logs private; no `secret_token` support upstream |
| Twilio SMS | none | Signature validation initializer (`403` on failure) |
| LINE | `X-Line-Signature` (fails closed) | none |
| Email | IMAP polling, no callback | none |
| Outbound account webhooks and bots | HMAC-SHA256 over `timestamp.body` with a per-webhook secret; 5-second timeout; account webhooks are not retried | HTTPS endpoints required |

## Easier sign-in and channel connection

Two native engine capabilities would remove most manual steps and are the recommended next product increments. **Meta embedded signup for WhatsApp** (`WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_CONFIGURATION_ID` on the engine) replaces copying four credentials with a Facebook popup, and channels created that way are signature-verified automatically. **OAuth mailboxes** (`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `AZURE_APP_ID/SECRET`) connect Gmail and Microsoft 365 without app passwords. For agents, the engine supports Google sign-in and exchanges its `sso_auth_token` for a session; wiring that into the branded login, and configuring transactional SMTP so password resets and invitations work, are the two changes that make sign-in self-service.

## External acceptance checklist

For each authorized channel, verify inbound message persistence, a public agent reply, private-note exclusion, actual provider delivery status, media, token revocation/reconnection, a second agent's access permissions, and that an unsigned or tampered callback is rejected. Do not infer successful connection from a saved configuration row. The UI labels a channel **Configured** until native reauthorization state says otherwise.
