# Third-party notices

OmniGrow uses upstream services and packages rather than claiming their implementations as original work. Dependencies and exact package versions are recorded in package-lock.json; container artifacts are pinned in the Compose files and Dockerfile.

- **Chatwoot 4.18.0** — [repository](https://github.com/chatwoot/chatwoot), [license](https://github.com/chatwoot/chatwoot/blob/v4.18.0/LICENSE). The source outside the enterprise directory is MIT licensed; enterprise code has separate terms. The official image retains upstream code and notices. No enterprise feature/license checks are bypassed.
- **Next.js, React, SWR, iron-session, Lucide, Zod, Rails ActionCable, TypeScript, Playwright** — used as dependencies under their upstream licenses; see each installed package's license file.
- **PostgreSQL, pgvector, Redis, Node.js, Caddy** — deployed as upstream container services; their distributions retain their notices. Redis versions have their own licensing terms.
- **LiveKit server 1.9.0 and LiveKit JavaScript/React packages** — [server](https://github.com/livekit/livekit/tree/v1.9.0), [Apache-2.0 license](https://github.com/livekit/livekit/blob/v1.9.0/LICENSE). Self-hosted WebRTC media and browser components retain their upstream licenses and notices.
- **HAProxy 3.2 LTS** — [project and licensing](https://github.com/haproxy/haproxy/blob/master/LICENSE). The upstream container provides TCP/TLS SNI routing; it is deployed separately without modifying its implementation.
- **Tiledesk** — [repository](https://github.com/Tiledesk/tiledesk); referenced for automation/handoff design. No Tiledesk runtime or code is bundled. A compatible webhook adapter is required to connect an external bot.
- **Chaskiq** — [repository](https://github.com/chaskiq/chaskiq); referenced for customer-engagement design. No Chaskiq code is copied or bundled; current source-available licensing is not presumed to grant unrestricted reuse.

Chatwoot, Tiledesk, and Chaskiq names belong to their respective owners. OmniGrow is not represented as an official product or endorsement from those projects.
