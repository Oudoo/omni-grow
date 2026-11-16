#!/bin/sh
# PostgreSQL starts first, so it also creates the shared secrets.
set -eu
/bin/sh /og/generate-secrets.sh
POSTGRES_PASSWORD=$(sed -n 's/^POSTGRES_PASSWORD=//p' /run/og/engine.env)
export POSTGRES_PASSWORD
exec docker-entrypoint.sh "$@"
