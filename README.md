# ScottyLabs Recruit

A centralized recruitment management platform for Carnegie Mellon's ScottyLabs
organization.

Students apply to multiple ScottyLabs committees through one website. Each
committee independently controls its own application questions, recruitment team,
applicant evaluations, and decisions. It replaces the current arrangement of
separate Google Forms, spreadsheets, and manual tracking.

Labrador is the first committee to use it. Every part of the system is built for
all committees from the start.

> **This branch is a rebuild.** The git history before `scottylabs-recruit` is
> the previous single-committee review platform, which is **live and in use** on
> `main`. Treat it as a quarry, not as the target —
> [`docs/v1-baseline.md`](docs/v1-baseline.md) says what to take and what to
> leave.

## What this is not

This platform **does not evaluate applicants with AI**. It does not score essays,
infer competence from text, scrape applicant links, or make accept/reject
decisions. Every subjective score originates from a named human reviewer, and
every aggregate is deterministic arithmetic over those human scores.

A committee also never sees another committee's applicants. Both constraints are
enforced architecturally, not by convention. See
[`docs/product-rules.md`](docs/product-rules.md).

## Stack

Built on [ScottyStack](https://github.com/scottylabs-labrador/ScottyStack),
ScottyLabs' full-stack typesafe template. See the
[ScottyStack Wiki](https://github.com/ScottyLabs/ScottyStack/wiki) for the
underlying conventions.

| Layer         | Technology                                                             |
| ------------- | ---------------------------------------------------------------------- |
| Monorepo      | Bun workspaces + Turborepo                                             |
| Server        | Express 5, tsoa (OpenAPI), Better Auth + Keycloak OIDC                 |
| Worker        | Bun process draining the notification outbox                           |
| Database      | PostgreSQL 17, Drizzle ORM                                             |
| Authorization | CASL, compiled to Drizzle `WHERE` clauses                              |
| Web           | React 19, Vite, TanStack Router/Query, React Hook Form, Zod, `dnd-kit` |
| Styling       | Tailwind v4, shadcn/ui                                                 |
| Files         | Cloudflare R2, presigned URLs                                          |
| Testing       | Vitest, PGlite, MSW, Playwright                                        |
| Deployment    | Railway, infrastructure in code                                        |

## Layout

```text
apps/
  server/            Express + tsoa API
  web/               React single-page app
  worker/            notification outbox drain and scheduled jobs
packages/
  access-control/    CASL abilities and the Drizzle WHERE compiler
  common/            pure domain functions: forms, scoring, status machines
  db/                Drizzle schema, migrations, seed
e2e/                 Playwright suites against a real stack
docs/                design, architecture, and decision records
```

## Getting started

Requires [Bun](https://bun.sh) 1.3.5 or newer. Everything below runs natively on
Windows, macOS, and Linux; the `.devcontainer` setup is optional.

```bash
bun install
bun run build:api     # generate the OpenAPI spec and client types — required first
bun run test
bun run quality       # oxfmt + oxlint
```

**`bun run build:api` must run before any typecheck or test.** The web app
imports generated types from `apps/server/build/`, which is gitignored. A fresh
clone that skips this step sees dozens of unrelated-looking type errors.

### Running the app locally

No ScottyLabs credentials required:

```bash
cp .env.local.example .env.local          # then set BETTER_AUTH_SECRET
docker compose -f .devcontainer/docker-compose.yml up -d postgres
bun run db:migrate:local
bun run db:seed:local                     # synthetic cycle, committees, applicants
bun run dev:local                         # web on :3000, API on :8080
```

With ScottyLabs organization access, Keycloak sign-in works too:

```bash
bun run secrets       # OIDC login to bao.scottylabs.org
bun run dev
```

Full setup, including what to provision and how to sign in without OpenBao
access, in [`docs/local-development.md`](docs/local-development.md).

## Documentation

**Read these four before writing code.** They are short, and they state which of
your defaults are wrong here.

| Document                                         | Contents                                               |
| ------------------------------------------------ | ------------------------------------------------------ |
| [`docs/collaboration.md`](docs/collaboration.md) | who owns what, the two tracks, how we merge            |
| [`AGENTS.md`](AGENTS.md)                         | the rules every contributor and agent follows          |
| [`docs/design.md`](docs/design.md)               | what we are building, why, and what is already decided |
| [`docs/product-rules.md`](docs/product-rules.md) | the constraints that override everything               |

Then, as needed:

| Document                                                 | Contents                                          |
| -------------------------------------------------------- | ------------------------------------------------- |
| [`docs/architecture.md`](docs/architecture.md)           | layering contract, request path, where code lives |
| [`docs/authorization.md`](docs/authorization.md)         | the permission model in full                      |
| [`docs/data-model.md`](docs/data-model.md)               | every table and its invariants                    |
| [`docs/api.md`](docs/api.md)                             | the route table                                   |
| [`docs/ui.md`](docs/ui.md)                               | every page, route, and component                  |
| [`docs/workstreams.md`](docs/workstreams.md)             | how the work splits across developers             |
| [`docs/local-development.md`](docs/local-development.md) | setup, secrets, database, troubleshooting         |
| [`docs/v1-baseline.md`](docs/v1-baseline.md)             | the previous version: what to take, what to leave |
| [`docs/adr/`](docs/adr/)                                 | architecture decision records                     |
| [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md)     | branch, commit, review, merge                     |

Documentation inherited from the previous version — [`docs/deployment.md`](docs/deployment.md),
[`docs/handover.md`](docs/handover.md), [`docs/running-a-cycle.md`](docs/running-a-cycle.md),
[`docs/guide.md`](docs/guide.md) — describes the **live v1 deployment**. It is
accurate about that system and is being replaced as this branch lands.

## Contributing

The work is split into **two tracks**, one per person, each with its own agent.
Open your track's entry point first:

- **[Track A — Apply](https://github.com/scottylabs-labrador/labrador-recruit/issues/33)**: the form system and everything a student touches
- **[Track B — Review](https://github.com/scottylabs-labrador/labrador-recruit/issues/34)**: who is allowed in, and everything after a submission arrives

[`docs/collaboration.md`](docs/collaboration.md) is the coordination contract:
file ownership, the three seams where the tracks touch, the merge protocol, and
the milestone gates. Every work item is a GitHub issue carrying its own
requirements and definition of done.

Trunk is `scottylabs-recruit`. **Do not target `main` — that is the live v1
deployment.** Process, branch naming, and the review bar are in
[`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md).

## License

Dual licensed under [MIT](LICENSE-MIT) and [Apache 2.0](LICENSE-APACHE).
