#!/bin/sh
# Rails: load generated secrets, wait for PostgreSQL via the upstream
# entrypoint, then prepare the database and start the server.
set -eu
set -a; . /run/og/engine.env; set +a
cd /app
exec docker/entrypoints/rails.sh /bin/sh /og/engine-run.sh
