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

# Environment variables
ARG VITE_SERVER_URL
ARG VITE_PUBLIC_POSTHOG_HOST
ARG VITE_PUBLIC_POSTHOG_KEY

# Build the web app
COPY . .
RUN bun run build --filter=@labrador/web...

################################################################################
# Aplication Stage
# Reference: https://docs.railway.com/guides/react#use-a-dockerfile
################################################################################

# Use the Caddy image
FROM caddy

# Create and change to the app directory.
WORKDIR /app

# Copy Caddyfile to the container image.
COPY apps/web/Caddyfile ./Caddyfile

# Copy local code to the container image.
RUN caddy fmt Caddyfile --overwrite

# Copy files to the container image.
COPY --from=builder /app/apps/web/dist ./dist

# Use Caddy to run/serve the app
CMD ["caddy", "run", "--config", "Caddyfile", "--adapter", "caddyfile"]
