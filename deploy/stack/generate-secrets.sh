#!/bin/sh
# Creates the deployment's private keys once. Existing files are never replaced:
# PostgreSQL keeps its first password and Rails needs stable encryption keys.
set -eu
dir=/run/og
umask 077
mkdir -p "$dir"
# Other containers may open known files but cannot list the directory.
chmod 711 "$dir"
hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

if [ ! -s "$dir/engine.env" ]; then
  {
    echo "SECRET_KEY_BASE=$(hex 64)"
    echo "ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY=$(hex 16)"
    echo "ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY=$(hex 16)"
    echo "ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT=$(hex 16)"
    echo "POSTGRES_PASSWORD=$(hex 24)"
    echo "REDIS_PASSWORD=$(hex 24)"
  } > "$dir/engine.env.tmp"
  mv "$dir/engine.env.tmp" "$dir/engine.env"
  echo "Generated messaging engine secrets."
fi

if [ ! -s "$dir/app.env" ]; then
  echo "SESSION_SECRET=$(hex 32)" > "$dir/app.env.tmp"
  # The web app image runs as the unprivileged node user (uid 1000).
  chown 1000:1000 "$dir/app.env.tmp"
  mv "$dir/app.env.tmp" "$dir/app.env"
  echo "Generated web app session secret."
fi
