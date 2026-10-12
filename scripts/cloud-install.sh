#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
node --version
npm --version
docker info >/dev/null
docker compose version
npm ci
npm run setup
npm run typecheck
npm test
npm run build
# Docker volumes and live processes may not survive cloud publication.
npm run snapshot
