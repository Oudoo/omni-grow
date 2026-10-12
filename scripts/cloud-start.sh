#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
npm run setup
if ! curl --fail --silent http://127.0.0.1:3000/api/health >/dev/null; then
  nohup npm run dev >.local/frontend.log 2>&1 </dev/null &
  printf '%s\n' "$!" >.local/frontend.pid
fi
for attempt in {1..90}; do
  if curl --fail --silent http://127.0.0.1:3000/api/health >.local/frontend-health.json; then
    node -e 'const fs=require("fs"); const result=JSON.parse(fs.readFileSync(".local/frontend-health.json","utf8")); if(result.status!=="ok"||result.messaging!=="reachable")process.exit(1)'
    printf '%s\n' 'OmniGrow frontend and messaging engine are ready for local development.'
    exit 0
  fi
  sleep 2
done
printf '%s\n' 'Startup did not become ready. Inspect .local/frontend.log and docker compose logs rails worker.' >&2
exit 1
