# Agent and Contributor Instructions

This file is the contract for everybody who writes code here — human or agent.
`CLAUDE.md` points at it. Read it before your first edit, and re-read section 3
before touching a service.

If you are an agent and you read nothing else, read sections 1, 3, 4, and 9.

---

## 0. What we are building

ScottyLabs Recruit: a centralized recruitment platform where CMU students apply
to multiple ScottyLabs committees through one site, and each committee
independently runs its own forms, reviewers, and decisions.

Full description: [`docs/design.md`](docs/design.md). Do not start a feature
without having read it — the design states which of your instincts are wrong
here.

The repository history before the `scottylabs-recruit` branch is the **previous
single-committee version**, which is live and in use. Treat it as a quarry, not
as the target. [`docs/v1-baseline.md`](docs/v1-baseline.md) says what to take
from it and what to leave.

---

## 1. The rule that overrides everything

**Never use an LLM or any ML model to evaluate an applicant.**

Do not generate scores from essays. Do not infer passion, competence, or fit
from text. Do not fetch, scrape, or crawl applicant-provided links. Do not
produce an automatic accept or reject, including by numeric cutoff.

The platform organizes human judgment. It does not supply judgment.

Full rules, including the one narrow verbatim-GitHub carve-out and the privacy
constraints, in [`docs/product-rules.md`](docs/product-rules.md). A change that
violates any of them is a defect regardless of how well it is implemented, and
it will be reverted rather than iterated on.

The place this rule gets broken by accident is aggregate scoring. "Compute a
summary score" means arithmetic over scores a named human entered, and nothing
else. If you cannot show a reviewer exactly which reviews contributed and how,
the number must not exist.

---

## 2. Style

Follow the
[ScottyStack Style Guides](https://github.com/ScottyLabs/ScottyStack/wiki/Style-Guides).
The conventions that bite most often:

- `function foo() {}`, never `const foo = () => {}`. TanStack Router relies on
  hoisting.
- `camelCase` variables and functions, `SCREAM_CASE` constants, `PascalCase.tsx`
  for components, `camelCase.ts` for modules, `kebab-case` for folders, JSON
  filenames, and assets.
- LF line endings everywhere. `.gitattributes` pins `* text=auto eol=lf` and
  `oxfmt` enforces it. On Windows, see
  [`docs/local-development.md`](docs/local-development.md) if `bun run format`
  suddenly reports every file as misformatted.
- Imports are sorted by `oxfmt`. Do not hand-sort them; run `bun run format:fix`.
- Comments explain _why_, not _what_. A comment restating the code is noise; a
  comment recording a decision, a trap, or a rejected alternative is the most
  valuable thing in the file. The previous version's `lib/authConfig.ts` is the
  house style for this.

---

## 3. Architecture — the layering contract

Read [`docs/architecture.md`](docs/architecture.md) before adding a feature.
The layering is strict and enforced in review:

```text
packages/db/src/schema/*.ts       tables, relations, $inferSelect types
packages/access-control/src/*     CASL abilities — imports types only, never the db client
packages/common/src/*             pure functions — no db, no network, no env
apps/server/src/services/*.ts     every drizzle query and every permission check
apps/server/src/controllers/*.ts  tsoa decorators only — no logic, no db access
apps/web/src/routes/*.tsx         TanStack Router; loaders prefetch, components read cache
apps/worker/src/*.ts              outbox drain — no HTTP surface
```

What each layer must not do:

| Layer                         | Must not                                          |
| ----------------------------- | ------------------------------------------------- |
| `packages/db`                 | contain business logic                            |
| `packages/access-control`     | import the db client — types only                 |
| `packages/common`             | touch the database, the network, or `process.env` |
| `apps/server/src/services`    | know about Express                                |
| `apps/server/src/controllers` | contain logic or touch the db                     |
| `apps/web/src/routes`         | re-implement a permission rule                    |
| `apps/worker`                 | expose an endpoint                                |

### Authorization is not optional and not yours to invent

Two tiers, applied to **every** resource:

1. **Read visibility compiles to SQL.** `drizzleWhere(...)` turns CASL rules
   into a Drizzle predicate that is `and()`-ed into every query, _including the
   pre-checks performed before an update or a delete_. A row the caller cannot
   see yields **404, not 403**, so the platform never leaks that a record
   exists.
2. **Mutation authority is a JS predicate.** After fetching a visible row, call
   `canUpdateX({ user, x })` and throw 403 on failure. Creation is checked up
   front, before any query runs.

**Never hand-write an ownership check like `eq(table.userId, user.id)`.**
Express it as a CASL rule, so the browser and the server enforce the identical
predicate. Interface hiding is never the only mechanism.

**Never trust a team id, cycle id, or application id from the client as proof of
access.** Resolve the caller's grants for that specific resource from the
database. An id in a path is an untrusted input.

This is the single thing most likely to produce a serious incident here: one
committee reading another committee's applicants. [`docs/authorization.md`](docs/authorization.md)
is the full model. If your change touches who can see what, say so in the pull
request description explicitly.

---

## 4. Verification — do not skip this

```bash
bun install
bun run build:api     # ALWAYS first. Generates the OpenAPI spec and client types.
bun run quality       # oxfmt + oxlint
bun run test          # turbo run test
bun run check         # the full gate: quality + tests + e2e
```

**`bun run build:api` must run before any typecheck or test.** The web app
imports its API types from `apps/server/build/`, which is gitignored. A fresh
clone that skips this sees dozens of unrelated-looking type errors.

**Never mark work complete without having run the command and read the output.**
Not "the change looks right". Not "tests should pass". Run it, paste the result.
If something fails, say what failed. A green claim that was never verified costs
more than a red one that was.

Notes that will save you an afternoon:

- The full run takes several minutes. Run one package while iterating:
  `bunx turbo run test --filter=@recruit/common`.
- When you add a table, add it to the `TRUNCATE` list in **both**
  `apps/server/test/harness.ts` and `e2e/db.ts`, or tests leak state between
  cases and fail in confusing, order-dependent ways.
- MSW runs with `onUnhandledRequest: "error"`. An endpoint a web test forgets to
  mock fails loudly instead of hanging. Add the handler in
  `apps/web/tests/msw/handlers.ts`.
- Commit messages are linted by commitlint (Conventional Commits). `deploy` is
  not a valid type. Use `feat`, `fix`, `ci`, `chore`, `docs`, `refactor`,
  `test`, `perf`, `style`, `build`, `revert`.

---

## 5. Tests

| Level      | Tooling                                                  | Location                                               |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Pure logic | Vitest                                                   | `packages/common/test`, `packages/access-control/test` |
| API        | Vitest + supertest + PGlite running real migrations      | `apps/server/test`                                     |
| Web        | Vitest + happy-dom + MSW + Testing Library, real routing | `apps/web/tests`                                       |
| End-to-end | Playwright against a booted stack                        | `e2e`                                                  |

Write the test first where you reasonably can. The parts of this system where a
test-first approach pays for itself immediately, because the rules are subtle
and the failure mode is silent:

- every access-control rule, including the negative cases — a reviewer without
  an assignment, a director of another committee, a revoked grant, an expired
  grant
- conditional-visibility evaluation, which has to agree between the browser
  renderer and the server validator
- submission atomicity and idempotency
- any scoring or aggregate arithmetic

A permission rule without a test proving the _denial_ path is not finished.

---

## 6. Secrets and applicant data

- **Never commit a real applicant export.** Fixtures are synthetic and
  structurally faithful. There are fixtures already; copy their shape.
- **Never paste a secret into a commit, an issue, a pull request, or a chat
  transcript.** A secret that appears in a transcript must be rotated. Secrets
  live in OpenBao and in Railway's variable editor, and nowhere else.
- Do not put applicant names, emails, or response text into PostHog, Sentry
  breadcrumbs, log lines, or URLs.
- Do not log full application payloads.

---

## 7. When the design does not answer your question

In order:

1. Re-read [`docs/design.md`](docs/design.md) section 13 — it lists what is
   deliberately left to you.
2. If the choice is local and reversible, make it, and say in the pull request
   that you made it.
3. If the choice is load-bearing — it changes the schema, the authorization
   model, the API shape, or a product rule — write an ADR in
   [`docs/adr/`](docs/adr/) and raise it before building on top of it.
4. If two readings of the spec lead to materially different work, ask. Do not
   pick one silently and build a week on it.

Do not widen scope on your own initiative. Finishing the task you were given
beats half-finishing a larger one you invented.

---

## 8. Working alongside other agents and developers

The work is split into parallel workstreams in
[`docs/workstreams.md`](docs/workstreams.md). Each has an owner, an explicit
interface with its neighbours, and a definition of done.

- **Claim your workstream before you start.** Two agents building the forms
  module produce two incompatible schemas and a day of merge pain.
- **Respect the interface boundary.** If you need something from a neighbouring
  workstream that does not exist yet, add the type or the stub in the shared
  package and leave it unimplemented with a `TODO(workstream-name)` marker.
  Do not reach across and implement somebody else's layer.
- **Schema changes are the highest-conflict surface.** One migration per pull
  request, and say in the description which tables it touches. If your
  workstream is not the owner of a table, propose the change rather than making
  it.
- Branches are `username/feature-name`. Rebase on `scottylabs-recruit` before
  opening a pull request.

---

## 9. Things in this repository that will mislead you

Read this list once. Each item has cost somebody real time.

- **The git history is the previous product.** Most code under `apps/` is the
  single-committee platform. It is a reference, not the target. Do not assume an
  existing file is where new code belongs.
- **`bun run build:api` ordering.** Already said twice. It is the single most
  common cause of "the repository is broken".
- **`@recruit/*` is the package scope.** The previous version used
  `@labrador/*`. If you see `@labrador/` anywhere, it is stale.
- **`labrador-recruit` is still correct in some places, and it is not a typo.**
  It is the Goldador team slug, so it is the right value for the Keycloak client
  ids (`labrador-recruit-prod`), the Keycloak groups (`labrador-recruit`,
  `labrador-recruit-admins`), and the OpenBao secret paths
  (`labrador-recruit/local/server`). Do not "fix" those to `scottylabs-recruit`.
  The npm scope, the local database name, and the project name are the things
  that changed.
- **The Keycloak realm has no login form.** It brokers straight to CMU SAML, so
  _every_ Andrew ID at the university authenticates successfully. Authentication
  therefore proves almost nothing. Authorization is the whole security boundary.
  See [`docs/design.md`](docs/design.md) section 3.2.
- **A global `admin` is not a recruitment admin.** Holding the Keycloak admin
  group lets you create cycles and issue grants. It does not let you read
  applicant data. That separation is deliberate; do not collapse it.
- **The callback path is `/api/auth/oauth2/callback/keycloak`**, which is what
  Keycloak has registered. Changing the `genericOAuth` `providerId` changes the
  callback URL and breaks sign-in after the user has already authenticated —
  the most confusing possible moment.
- **`VITE_SERVER_URL` is read at build time.** Changing it needs a rebuild, not
  a restart.
- **`routeTree.gen.ts` is generated.** It is in `files.readonlyInclude` and
  excluded from `oxfmt`. Never edit it.
- **Migrations run from `apps/server/docker-entrypoint.sh`**, not from Railway's
  `preDeployCommand` and not from your laptop. A deploy that ran `drizzle-kit
migrate` from a firewalled laptop once exited 0 having applied nothing, and
  the first request 500'd.
- **Known debt inherited from the previous version** is listed in
  [`docs/v1-baseline.md`](docs/v1-baseline.md). Check it before you spend an
  hour on a bug somebody already documented.

---

## 10. Reference

- [`docs/design.md`](docs/design.md) — what we are building and why
- [`docs/architecture.md`](docs/architecture.md) — where code lives, how a
  request flows
- [`docs/product-rules.md`](docs/product-rules.md) — the rule that overrides
  everything
- [`docs/authorization.md`](docs/authorization.md) — the permission model
- [`docs/data-model.md`](docs/data-model.md) — tables and invariants
- [`docs/api.md`](docs/api.md) — route table
- [`docs/ui.md`](docs/ui.md) — pages, routes, components
- [`docs/workstreams.md`](docs/workstreams.md) — who builds what
- [`docs/local-development.md`](docs/local-development.md) — setup and
  troubleshooting
- [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) — process
- [ScottyStack Wiki](https://github.com/ScottyLabs/ScottyStack/wiki) — the
  underlying template's conventions
- [ScottyStack demo branch](https://github.com/scottylabs-labrador/ScottyStack/tree/demo)
  — the worked example for feature structure
