# syntax=docker/dockerfile:1
# Thin wrappers around the pinned upstream images for compose.coolify.yaml.
# Secrets are generated on first start into the shared og-secrets volume, so a
# hosting panel only needs the owner login and public hostnames.

FROM pgvector/pgvector@sha256:7b822b0aac60967beb1ea5e576b8602c94c300a157d187f385ae3e0da199b90a AS postgres
COPY deploy/stack/generate-secrets.sh deploy/stack/postgres-start.sh /og/
ENTRYPOINT ["/bin/sh", "/og/postgres-start.sh"]
CMD ["postgres"]

FROM redis@sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499 AS redis
COPY deploy/stack/redis-start.sh deploy/stack/redis-health.sh /og/
ENTRYPOINT ["/bin/sh", "/og/redis-start.sh"]
CMD []

FROM chatwoot/chatwoot@sha256:a4b7eea7353a9b585d0f29f2c57c7549710db961b119f7f1561b2fe964f48f65 AS engine
COPY scripts/bootstrap.rb /app/omnigrow-bootstrap.rb
COPY deploy/stack/engine-start.sh deploy/stack/engine-run.sh deploy/stack/worker-start.sh /og/
