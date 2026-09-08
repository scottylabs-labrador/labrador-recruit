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

The `packages/db` scripts resolve their `DATABASE_URL` through secretspec, so they need
ScottyLabs OpenBao access:

```bash
cd packages/db
bun run db:migrate    # apply migrations
bun run db:seed       # synthetic development data
bun run db:studio     # browse the database
```

Without that access, use the `:local` equivalents from the repository root, which read
`.env.local` instead. These are the ones to reach for on a fresh checkout:

```bash
bun run db:migrate:local
bun run db:seed:local
```

`db:seed:local` creates the `fall-2026` cycle outright rather than reconciling one, so a
second run stops on the slug's unique constraint. Re-seeding means starting from an empty
database:

```bash
docker exec labrador-recruit-postgres psql -U postgres -c 'DROP DATABASE "labrador-recruit" WITH (FORCE)' -c 'CREATE DATABASE "labrador-recruit"'
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

Sign-in works locally with an Andrew ID and a password. Create an account first —
registration is closed, so there is no way to make one from the interface:

```bash
bun run apps/server/scripts/createAccount.ts rjones "Robin Jones" --admin
```

It prints a temporary password once. Sign in with the Andrew ID (`rjones`, not the
full address) at `http://localhost:3000`, and the application will make you choose
your own password before it shows you anything.

`--admin` grants the **global** admin role. That is enough to create a cycle and
grant memberships, but not to read applicant data: the account still needs a
recruitment membership, which it must grant itself explicitly. That separation is
deliberate — see [`architecture.md`](architecture.md).

**The "Sign in with your Andrew ID" button is a different thing** and does not work
locally. It goes to Keycloak, and `.env.local.example` ships a placeholder
`AUTH_ISSUER` (`auth.example.com`) that does not resolve.

What decides this is `AUTH_CLIENT_ID`, not the issuer. It ships as the sentinel
`not-yet-registered`, which `isClientIdRegistered` reads as "no identity provider
here": the interface withholds the Keycloak button rather than sending you to a
provider that will reject you, and `PASSWORD_SIGN_IN=auto` turns the password form
on in its place. Setting `AUTH_CLIENT_ID` to any other value flips **both** — the
button appears and the password form disappears — so a plausible-looking
placeholder there leaves no way to sign in at all.

There is also `dev:login`, which mints a session directly without a password:

```bash
bun run dev:login rjones --admin --name "Robin Jones"
```

It prints a `document.cookie = ...` line to paste into the browser console. This is
a **script, not an endpoint**, on purpose. A dev-login route would be one
misconfigured environment variable away from letting anyone authenticate as an
administrator in production. A script an operator runs against a database they
already control adds no attack surface to the deployed server.

### Moving to Keycloak sign-in

Register the project in [Goldador](https://scottylabs-labrador.github.io/goldador/),
which issues the OIDC client id and secret, then provision the vault items that
`secretspec.toml` points at under `labrador-recruit/...` and use `bun run dev`
instead of `bun run dev:local`.

Password accounts keep working afterwards. The global role prefers an identity
provider's `groups` claim when there is a token to read it from, and falls back to
the role stored on the user row.

## Troubleshooting

**`bun run test` fails in the web app with an unhandled request error.** MSW runs with
`onUnhandledRequest: "error"`. Add a handler in `apps/web/tests/msw/handlers.ts` for the
endpoint your test triggers.

**Server tests see rows from a previous test.** Every new table must be added to the
`TRUNCATE` statement in `apps/server/test/harness.ts`, and to `e2e/db.ts` for Playwright.

**The web app cannot find `@labrador/server/build/swagger`.** Run `bun run build:api`.

**`port in use`.** The web app uses 3000 and the server 80 by default. Find the holder with
`lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows).
