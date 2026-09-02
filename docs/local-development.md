# Local Development

## Prerequisites

- [Bun](https://bun.sh) 1.3.5 or newer (`packageManager` pins 1.3.5; `bunx only-allow bun`
  rejects npm, yarn, and pnpm).
- PostgreSQL 17, or Docker to run it.

Node.js is only needed if you run the TypeScript-config tooling (`syncpack`) directly.

Everything below runs natively on Windows, macOS, and Linux. The `.devcontainer` setup is
available but optional; it installs its extra tooling through Homebrew and therefore
targets macOS and Linux.

### Windows line endings

The repository requires LF line endings (`.editorconfig`, and `oxfmt` enforces it). A
`.gitattributes` file pins `* text=auto eol=lf`, so a fresh clone is correct even with
`core.autocrlf=true` set globally. If you cloned before that file existed and
`bun run format` reports every file as misformatted, renormalize:

```bash
git config core.autocrlf false
git rm --cached -r . -q
git reset --hard
```

## First run

```bash
bun install
bun run build:api     # required before any typecheck or test
bun run test
bun run quality
```

`bun run build:api` generates `apps/server/build/swagger.yaml`, `build/swagger.d.ts`, and
`build/routes.ts`. These are gitignored, so a fresh clone must generate them before the
web app will typecheck — it imports its API types from that directory.

## Database

```bash
docker compose -f .devcontainer/docker-compose.yml up -d postgres
```

That serves PostgreSQL on `localhost:5432` with user `postgres`, password
`donotuseinprod`, database `labrador-recruit`.

```bash
cd packages/db
bun run db:migrate    # apply migrations
bun run db:seed       # synthetic development data
bun run db:studio     # browse the database
```

## Secrets

Secrets resolve through [secretspec](https://secretspec.dev) against ScottyLabs' OpenBao
instance. This requires ScottyLabs organization access and a project registered in
[Goldador](https://scottylabs-labrador.github.io/goldador/), which issues the Keycloak
OIDC client ID and secret.

```bash
bun run secrets       # OIDC login to bao.scottylabs.org with CMU credentials
bun run dev
```

`secretspec.toml` currently points at vault items under `labrador-recruit/...`. Those paths
must be provisioned in OpenBao before `secretspec run -P local` will resolve. Until then,
use the offline path below.

### Running without OpenBao access

Tests never need secrets. `apps/server/test/setup.ts` seeds `process.env` before any
module that validates it is imported, and the server, web, and access-control suites run
against PGlite. So `bun install`, `bun run build:api`, `bun run test`, and
`bun run quality` all work offline.

The app itself also runs offline, through a parallel set of `:local` scripts that load a
gitignored `.env.local` with dotenv-cli instead of resolving secrets through secretspec:

```bash
cp .env.local.example .env.local          # then set BETTER_AUTH_SECRET
docker compose -f .devcontainer/docker-compose.yml up -d postgres
bun run db:migrate:local
bun run db:seed:local                     # synthetic cycle, committees, applicants
bun run dev:local                         # web on :3000, API on :8080
```

### Signing in locally

**The "Sign In" button does not work locally, and cannot.** It redirects to Keycloak, and
`.env.local.example` ships a placeholder `AUTH_ISSUER` (`auth.example.com`) that does not
resolve. Better Auth cannot fetch the OIDC discovery document, the request 500s, and the
interface reports "Could not reach the sign-in provider". That is the correct behaviour for
an unreachable identity provider — it is not a bug in the app.

To sign in without Keycloak, mint a session directly:

```bash
bun run dev:login rjones --admin --name "Robin Jones"
```

It prints a `document.cookie = ...` line to paste into the browser console at
`http://localhost:3000`. Reload and you are signed in.

This is a **script, not an endpoint**, on purpose. A dev-login route would be one
misconfigured environment variable away from letting anyone authenticate as an
administrator in production. A script an operator runs against a database they already
control adds no attack surface to the deployed server.

`--admin` puts the user in the configured admin group, which grants the **global** admin
role. That is enough to create a cycle and grant memberships, but not to read applicant
data: the account still needs a recruitment membership, which it must grant itself
explicitly. That separation is deliberate — see [`architecture.md`](architecture.md).

### Moving to real Keycloak sign-in

Register the project in [Goldador](https://scottylabs-labrador.github.io/goldador/), which
issues the OIDC client id and secret, then provision the vault items that
`secretspec.toml` points at under `labrador-recruit/...` and use `bun run dev` instead of
`bun run dev:local`.

## Troubleshooting

**`bun run test` fails in the web app with an unhandled request error.** MSW runs with
`onUnhandledRequest: "error"`. Add a handler in `apps/web/tests/msw/handlers.ts` for the
endpoint your test triggers.

**Server tests see rows from a previous test.** Every new table must be added to the
`TRUNCATE` statement in `apps/server/test/harness.ts`, and to `e2e/db.ts` for Playwright.

**The web app cannot find `@labrador/server/build/swagger`.** Run `bun run build:api`.

**`port in use`.** The web app uses 3000 and the server 80 by default. Find the holder with
`lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows).
