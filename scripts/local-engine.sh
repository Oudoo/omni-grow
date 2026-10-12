#!/bin/sh
set -eu
web_pid=''
worker_pid=''
cleanup() {
  trap - EXIT INT TERM
  [ -z "$web_pid" ] || kill -TERM "$web_pid" 2>/dev/null || true
  [ -z "$worker_pid" ] || kill -TERM "$worker_pid" 2>/dev/null || true
  [ -z "$web_pid" ] || wait "$web_pid" 2>/dev/null || true
  [ -z "$worker_pid" ] || wait "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
bundle exec sidekiq -C config/sidekiq.yml &
worker_pid=$!
printf '%s\n' "$worker_pid" >/tmp/omnigrow-worker.pid
bundle exec rails s -p 3000 -b 0.0.0.0 &
web_pid=$!
# Either process failing restarts the supervised service instead of silently
# leaving message delivery without a worker.
while kill -0 "$worker_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do sleep 1; done
exit 1
