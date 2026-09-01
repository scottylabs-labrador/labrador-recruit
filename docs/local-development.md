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

Tests do not need secrets. `apps/server/test/setup.ts` seeds `process.env` before any
module that validates it is imported, and the server, web, and access-control suites all
run against PGlite. So `bun install`, `bun run build:api`, `bun run test`, and
`bun run quality` all work offline.

Only `bun run dev` — the live server and web app — requires resolvable secrets.

## Troubleshooting

**`bun run test` fails in the web app with an unhandled request error.** MSW runs with
`onUnhandledRequest: "error"`. Add a handler in `apps/web/tests/msw/handlers.ts` for the
endpoint your test triggers.

**Server tests see rows from a previous test.** Every new table must be added to the
`TRUNCATE` statement in `apps/server/test/harness.ts`, and to `e2e/db.ts` for Playwright.

**The web app cannot find `@labrador/server/build/swagger`.** Run `bun run build:api`.

**`port in use`.** The web app uses 3000 and the server 80 by default. Find the holder with
`lsof -i :3000` (macOS/Linux) or `netstat -ano | findstr :3000` (Windows).
