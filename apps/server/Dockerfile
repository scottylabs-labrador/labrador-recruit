# syntax=docker/dockerfile:1.7-labs
# Base image with Bun
FROM oven/bun:latest AS base
WORKDIR /app

# Build stage
FROM base AS builder

# Copy dependency manifests first so install is cached when only source changes.
# `COPY --parents` preserves the apps/*/ and packages/*/ paths so the workspace
# manifests land where bun expects them. It is a labs feature, so the syntax
# directive above is required; without it BuildKit fails with "unknown flag".
COPY package.json bun.lock ./
COPY --parents apps/*/package.json packages/*/package.json ./
RUN bun ci

# Build the server
COPY . .
RUN bun run build --filter=@labrador/server...

# Final runtime image
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN groupadd --system --gid 1001 server && \
    useradd --system --uid 1001 --gid 1001 server

# Copy Swagger spec
COPY --from=builder --chown=server:server \
  /app/apps/server/build/swagger.yaml \
  /app/apps/server/build/swagger.yaml

# Copy Swagger UI dist
# (which can be either in apps/node_modules or apps/server/node_modules)
# COPY --from=builder --chown=server:server \
#   /app/apps/node_modules/swagger-ui-dist \
#   /app/apps/node_modules/swagger-ui-dist
COPY --from=builder --chown=server:server \
  /app/apps/server/node_modules/swagger-ui-dist \
  /app/apps/server/node_modules/swagger-ui-dist

# Copy only what's needed to run the server
COPY --from=builder --chown=server:server \
  /app/apps/server/dist \
  /app/apps/server/dist

COPY --from=builder --chown=server:server \
  /app/apps/server/src/instrument.ts \
  /app/apps/server/src/instrument.ts

# Install Sentry and migration toolchain.
# drizzle-kit@0.31 hangs after "Using 'pg' driver" and never exits 0.
# Pin 0.30.5: https://github.com/drizzle-team/drizzle-orm/issues/4451#issuecomment-4468994792
RUN bun install @sentry/bun drizzle-kit@0.30.5 drizzle-orm pg

# Copy database package artifacts to enable migrations.
COPY --from=builder --chown=server:server \
  /app/packages/db/drizzle \
  /app/apps/server/drizzle

COPY --from=builder --chown=server:server \
  /app/packages/db/drizzle.config.ts \
  /app/apps/server/drizzle.config.ts

COPY --from=builder --chown=server:server \
  /app/apps/server/docker-entrypoint.sh \
  /app/apps/server/docker-entrypoint.sh
RUN chmod +x /app/apps/server/docker-entrypoint.sh

USER server
EXPOSE 3000
WORKDIR /app/apps/server
CMD ["./docker-entrypoint.sh"]
