#!/bin/sh
set -eu
bundle exec rails db:chatwoot_prepare

# Provision the first workspace owner once. Afterwards the owner is tracked by
# ID, so changing the email or password in the app is never undone here.
state=/run/og/bootstrap-state.json
if [ ! -s "$state" ]; then
  if [ -z "${OG_OWNER_EMAIL:-}" ] || [ -z "${OG_OWNER_PASSWORD:-}" ]; then
    echo "Set OG_OWNER_EMAIL and OG_OWNER_PASSWORD to create the first workspace owner." >&2
    exit 1
  fi
  ruby -rjson -e 'print JSON.generate(
    "email" => ENV.fetch("OG_OWNER_EMAIL").strip,
    "password" => ENV.fetch("OG_OWNER_PASSWORD"),
    "name" => ENV.fetch("OG_OWNER_NAME", "Workspace owner"),
    "workspace" => ENV.fetch("OG_WORKSPACE_NAME", "OmniGrow"))' \
    | bundle exec rails runner /app/omnigrow-bootstrap.rb > /tmp/og-bootstrap.out
  grep -v '^OG_BOOTSTRAP_JSON:' /tmp/og-bootstrap.out || true
  provisioned=$(sed -n 's/^OG_BOOTSTRAP_JSON://p' /tmp/og-bootstrap.out)
  if [ -z "$provisioned" ]; then echo "Owner provisioning did not confirm the owner." >&2; exit 1; fi
  umask 077
  printf '%s\n' "$provisioned" > "$state"
fi

unset OG_OWNER_PASSWORD
exec bundle exec rails s -p 3000 -b 0.0.0.0
