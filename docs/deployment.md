# Deployment

Railway, following the ScottyStack convention. Three services: Postgres, the API,
and the web client.

## Before you start

1. **Railway access.** Ask to be added to the ScottyLabs Railway project — the
   wiki says this is granted per team.
2. **A Keycloak client.** Register the project in
   [Goldador](https://scottylabs-labrador.github.io/goldador/), which creates the
   OIDC client and puts its id and secret in OpenBao under
   `labrador-recruit/generated/…`.
3. **Never paste the client secret into a chat, an issue, or a commit.** Put it
   straight into Railway's variable editor or OpenBao. A secret that appears in
   a transcript has to be rotated.

## Identity provider

These are verified against the live realm and need no discovery:

| Variable             | Value                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| `AUTH_ISSUER`        | `https://idp.scottylabs.org/realms/labrador`                               |
| `AUTH_JWKS_URI`      | `https://idp.scottylabs.org/realms/labrador/protocol/openid-connect/certs` |
| `AUTH_CLIENT_ID`     | from Goldador                                                              |
| `AUTH_CLIENT_SECRET` | from Goldador                                                              |

**Register the redirect URI in Keycloak**, or sign-in fails after the user has
already authenticated, which is the most confusing possible moment:

```text
https://<api-domain>/api/auth/oauth2/callback/keycloak
```

That path comes from the `genericOAuth` provider id in
`apps/server/src/lib/auth.ts`. Changing `providerId` changes the callback URL.

## Service: Postgres

Add Railway's Postgres plugin. It supplies `DATABASE_URL`. Nothing else needed —
`packages/db/drizzle.config.ts` sets `ssl: "require"`, which Railway needs
because its certificates are self-signed.

## Service: API

Root directory `/`, Dockerfile `apps/server/Dockerfile`. `railway.json` already
sets the builder, the watch paths, and the pre-deploy migration.

| Variable                | Value                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`          | reference the Postgres service                             |
| `SERVER_URL`            | the API's public domain, `https://…`                       |
| `SERVER_PORT`           | `8080`, or whatever Railway assigns                        |
| `BETTER_AUTH_URL`       | the **web** domain, not the API's                          |
| `BETTER_AUTH_SECRET`    | `openssl rand -base64 32`, generated fresh                 |
| `ALLOWED_ORIGINS_REGEX` | `^https://<web-domain>$`                                   |
| `ADMIN_GROUP`           | the Keycloak group whose members get the global admin role |
| `AUTH_*`                | as above                                                   |
| `SENTRY_DSN`            | optional                                                   |

`ALLOWED_ORIGINS_REGEX` is a regular expression, so escape the dots if you want
to be strict. Getting it wrong produces CORS failures that look like the API
being down.

Migrations run as the Railway pre-deploy command already declared in
`apps/server/railway.json`. If serverless is enabled the pre-deploy can fail
while the database wakes; redeploying fixes it.

## Service: web

Root directory `/`, Dockerfile `apps/web/Dockerfile`, served by Caddy on
`$PORT`.

**`VITE_*` variables are baked in at build time, not read at runtime.** They must
be set as Railway _build arguments_, and changing one requires a rebuild rather
than a restart:

| Build argument             | Value                   |
| -------------------------- | ----------------------- |
| `VITE_SERVER_URL`          | the API's public domain |
| `VITE_PUBLIC_POSTHOG_KEY`  | optional                |
| `VITE_PUBLIC_POSTHOG_HOST` | optional                |

Leaving the PostHog key unset logs a console error on every page load. Harmless,
but noisy enough to be worth setting or removing.

## First run

The database starts empty, and there is deliberately no way to bootstrap an
admin from the outside.

1. Sign in through Keycloak once, so Better Auth creates your user row. The id
   is your Andrew ID, taken from the `full_email` claim.
2. Add yourself to the Keycloak group named in `ADMIN_GROUP`. That grants the
   **global** admin role, which is enough to create a cycle and nothing else.
3. Create a cycle, then grant yourself a `recruitment_admin` membership in it.
   Holding the infrastructure role does not by itself reveal applicant data, and
   the grant is recorded in the audit log.

See [`running-a-cycle.md`](running-a-cycle.md) from there.

## Things that will bite you

**The Dockerfiles need BuildKit.** Both begin with
`# syntax=docker/dockerfile:1.7-labs` because they use `COPY --parents`, which is
a labs feature. Without that line the build fails with `unknown flag: --parents`.
Railway uses BuildKit, so this works, but a plain `docker build` on an old
daemon will not.

**`bun run build:api` must succeed before the web app compiles.** The client
imports its types from `apps/server/build/`, which is generated and gitignored.
The server Dockerfile runs it through `turbo`; the web Dockerfile depends on the
server package for the same reason.

**Check the health endpoint after deploying.** `GET /` on the API returns
`{"status":"ok"}` without touching the database, so a 200 there with a failing
app usually means `DATABASE_URL`.

## Verifying a deployment

```bash
curl https://<api-domain>/                # {"status":"ok"}
curl https://<api-domain>/openapi.json    # the generated spec
```

`https://<api-domain>/swagger` serves Swagger UI, which is the quickest way to
confirm authentication end to end: it will refuse every recruitment endpoint
with a 401 until you present a session.
