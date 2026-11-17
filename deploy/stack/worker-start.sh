#!/bin/sh
set -eu
set -a; . /run/og/engine.env; set +a
cd /app
exec bundle exec sidekiq -C config/sidekiq.yml
