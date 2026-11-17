#!/bin/sh
set -eu
REDIS_PASSWORD=$(sed -n 's/^REDIS_PASSWORD=//p' /run/og/engine.env)
if [ -z "$REDIS_PASSWORD" ]; then echo "Generated Redis password is missing; start postgres first." >&2; exit 1; fi
exec docker-entrypoint.sh redis-server --appendonly yes --requirepass "$REDIS_PASSWORD"
