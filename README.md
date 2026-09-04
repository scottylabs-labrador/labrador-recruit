# Recruit

Internal recruitment review platform for ScottyLabs leadership.

Leadership imports the committee application form export, reviewers independently score
applicants against a configurable rubric, and the platform surfaces aggregate results,
reviewer disagreement, and committee rankings so leadership can make final placement
decisions.

## What this is not

This platform **does not evaluate applicants with AI**. It does not score essays, infer
competence from text, scrape applicant links, or make accept/reject decisions. Every
subjective score originates from a named human reviewer, and every aggregate is
deterministic math over those human scores. See [`docs/product-rules.md`](docs/product-rules.md).

## Stack

Built on [ScottyStack](https://github.com/scottylabs-labrador/ScottyStack), ScottyLabs'
full-stack typesafe template. See the
[ScottyStack Wiki](https://github.com/ScottyLabs/ScottyStack/wiki) for the underlying
conventions.

| Layer         | Technology                                                      |
| ------------- | --------------------------------------------------------------- |
| Monorepo      | Bun workspaces + Turborepo                                      |
| Server        | Express 5, tsoa (OpenAPI), Better Auth (password or Keycloak)   |
| Database      | PostgreSQL, Drizzle ORM                                         |
| Authorization | CASL, compiled to Drizzle `WHERE` clauses                       |
| Web           | React 19, Vite, TanStack Router/Query/Form, Tailwind v4, shadcn |
| Testing       | Vitest, PGlite, MSW, Playwright                                 |

## Layout

```text
apps/
  server/            Express + tsoa API
  web/               React single-page app
packages/
  access-control/    CASL abilities and the Drizzle WHERE compiler
  common/            Shared types and utilities
  db/                Drizzle schema, migrations, seed
e2e/                 Playwright suites against a real stack
docs/                Architecture notes and ADRs
```

## Getting started

Requires [Bun](https://bun.sh) 1.3.5+. On Windows, everything below runs natively; the
`.devcontainer` setup is optional.

```bash
bun install
bun run build:api     # generate the OpenAPI spec and client types (required first)
bun run test
bun run quality       # oxfmt + oxlint
```

`bun run build:api` must run before typechecking or testing the web app, because the web
app imports generated types from `apps/server/build/`.

### Running the app locally

No ScottyLabs credentials required:

```bash
cp .env.local.example .env.local          # then set BETTER_AUTH_SECRET
docker compose -f .devcontainer/docker-compose.yml up -d postgres
bun run db:migrate:local
bun run db:seed:local                     # synthetic cycle and applicants
bun run dev:local                         # web on :3000, API on :8080

bun run apps/server/scripts/createAccount.ts rjones "Robin Jones" --admin
```

That last command prints a temporary password once. Sign in with the Andrew ID at
`http://localhost:3000`; the application makes you choose your own password before it
shows you anything. Registration is closed on purpose — the Andrew ID is the key every
membership, assignment and review points at, so it is granted rather than self-asserted.

The separate **"Sign in with your Andrew ID"** button goes to Keycloak and does not work
locally: the local environment ships a placeholder issuer that does not resolve, and the
interface withholds the button rather than sending you somewhere that will reject you.

With ScottyLabs organization access, Keycloak sign-in works too:

```bash
bun run secrets       # OIDC login to bao.scottylabs.org
bun run dev
```

See [`docs/local-development.md`](docs/local-development.md) for the full setup, including
what to provision before `bun run dev` will resolve.

## Documentation

| Document                                                 | Contents                                              |
| -------------------------------------------------------- | ----------------------------------------------------- |
| [`docs/guide.md`](docs/guide.md)                         | The complete guide: usage, features, stack, internals |
| [`docs/handover.md`](docs/handover.md)                   | Taking this over: deployment, access, traps, debt     |
| [`docs/running-a-cycle.md`](docs/running-a-cycle.md)     | Operational runbook: import, assign, review, decide   |
| [`docs/architecture.md`](docs/architecture.md)           | Where recruitment code lives and how a request flows  |
| [`docs/product-rules.md`](docs/product-rules.md)         | The no-AI-evaluation rule and privacy constraints     |
| [`docs/local-development.md`](docs/local-development.md) | Setup, secrets, database, troubleshooting             |

## License

Dual licensed under [MIT](LICENSE-MIT) and [Apache 2.0](LICENSE-APACHE).
