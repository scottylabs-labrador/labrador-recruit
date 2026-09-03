#!/bin/sh
# Apply pending migrations, then start the server.
#
# Migrations run from the deployment rather than from whoever is deploying:
# a laptop behind a firewall that blocks outbound Postgres will let
# `drizzle-kit migrate` exit 0 having done nothing, and the first request
# then 500s against a schema that was never updated.
#
# `set -e` is what makes this safe. If the migration fails the container dies
# and Railway keeps the previous deployment serving, which is the right
# outcome: no traffic reaches a half-migrated database.
set -e

echo "[entrypoint] applying database migrations"
bunx drizzle-kit migrate
echo "[entrypoint] migrations applied, starting server"

exec bun --preload ./src/instrument.ts dist/server.js
