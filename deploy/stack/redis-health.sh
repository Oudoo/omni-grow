#!/bin/sh
REDISCLI_AUTH=$(sed -n 's/^REDIS_PASSWORD=//p' /run/og/engine.env) redis-cli ping | grep -q PONG
