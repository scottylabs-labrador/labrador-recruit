# Contributing to ScottyLabs Recruit

Base conventions:
[ScottyLabs Base Contributing Guide](https://github.com/ScottyLabs/wiki/wiki/Base-Contributing-Guide)
and the
[ScottyStack Style Guides](https://github.com/ScottyLabs/ScottyStack/wiki/Style-Guides).
This document covers what is specific to this project.

---

## Before your first commit

Read, in this order:

1. [`AGENTS.md`](../AGENTS.md) — the contract. Applies to humans and agents
   identically.
2. [`docs/design.md`](../docs/design.md) — what we are building and what is
   already decided.
3. [`docs/product-rules.md`](../docs/product-rules.md) — the constraints that
   override everything.
4. The entry for your workstream in
   [`docs/workstreams.md`](../docs/workstreams.md).

If your work touches who can see what — and more of it does than you would
expect — also read [`docs/authorization.md`](../docs/authorization.md) in full.

---

## Claim a workstream first

The work is split into fourteen parallel workstreams in
[`docs/workstreams.md`](../docs/workstreams.md), each with an owner, the files it
owns, the interface it exposes, and a definition of done.

**Put your name in the table and open a tracking issue before you start.** Two
people independently building the forms module produce two incompatible schemas
and a day of merge pain. This has a high enough chance of actually happening that
it is the first rule here.

You may read anything. To change a file another workstream owns, propose it.

When you need something from a neighbouring workstream that does not exist yet:
add the type and a stub to the shared package **they** own, mark it
`TODO(workstream-name)`, build against the type, and tell the owner. Do not
implement their layer in yours "for now".

---

## Branches and commits

```text
username/feature-name
```

Branch from `scottylabs-recruit`, and rebase on it before opening a pull request.
`main` is the **live v1 deployment** — do not target it.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and
are linted by commitlint. Valid types: `feat`, `fix`, `ci`, `chore`, `docs`,
`refactor`, `test`, `perf`, `style`, `build`, `revert`. **`deploy` is not a
type** — that one catches everybody once.

Write the subject as what the change does for a person, not what you edited:

```text
feat(forms): publish a version instead of editing the live one
fix(review): stop a reviewer seeing peer scores before submitting
```

---

## Before you open a pull request

```bash
bun run build:api     # ALWAYS first
bun run quality       # oxfmt + oxlint
bun run test
bun run check         # the full gate: quality + tests + e2e
```

**Run them. Read the output. Do not assert a result you did not see.** A green
claim that was never verified costs more than a red one that was, because
somebody else finds it later and in a worse place.

The full run takes several minutes. While iterating, narrow it:

```bash
bunx turbo run test --filter=@recruit/common
bunx turbo run test --filter=@recruit/server
```

Husky runs `editorconfig-checker`, `syncpack`, `markdownlint-cli2`, and
`bun run check` on pre-commit. If a hook fails, fix the cause — do not pass
`--no-verify`.

---

## Pull request description

Say what changed and why. Then, explicitly:

- **If it changes who can see what, say so in those words.** Those pull requests
  get a different level of review, and the reviewer needs to know to give it.
- **If it includes a migration, list the tables it touches.** One migration per
  pull request.
- **If you made a judgement call the design left open, name it.** A sentence is
  enough. See [`docs/design.md`](../docs/design.md) section 13 for what is
  deliberately left to you.
- **If something is incomplete, say what and why.** Known debt that is written
  down is manageable. Known debt that is not is a trap for the next person.

If the decision is load-bearing — schema, authorization model, API shape, or a
product rule — write an ADR in [`docs/adr/`](../docs/adr/) and get it agreed
_before_ building on top of it.

---

## The review bar

A reviewer is checking for these, roughly in order of how much they matter:

1. **Does it violate a product rule?** No model evaluating applicants, no
   cross-committee leakage, no aggregate whose derivation cannot be shown. A
   change that violates one is reverted rather than iterated on.
2. **Is authorization expressed correctly?** A CASL rule, not a hand-written
   ownership check. 404 for invisible rows, not 403. No trusting an id from the
   client as proof of access. Reuse of an existing visibility rule rather than a
   second copy of it.
3. **Does it respect the layering contract?**
   [`AGENTS.md`](../AGENTS.md) section 3. Controllers with logic, services that
   know about Express, and an access-control package importing the db client are
   all blocking.
4. **Are the denial paths tested?** An access-control rule without a test proving
   the refusal is not finished. The matrix is in
   [`docs/authorization.md`](../docs/authorization.md) section 9.
5. **Do the invariants live in the database where they can?** A `CHECK`, a
   partial unique index, or a composite foreign key beats a service-level check
   that the next caller forgets.
6. **Does it leak applicant data anywhere new?** Logs, URLs, analytics, Sentry,
   email payloads, error messages.
7. **Is it readable by the next person?** Comments that record a decision, a
   trap, or a rejected alternative are the most valuable thing in a file.
   Comments restating the code are noise.

---

## Writing tests

| Level      | Tooling                                          | Location                                               |
| ---------- | ------------------------------------------------ | ------------------------------------------------------ |
| Pure logic | Vitest                                           | `packages/common/test`, `packages/access-control/test` |
| API        | Vitest + supertest + PGlite with real migrations | `apps/server/test`                                     |
| Web        | Vitest + happy-dom + MSW + Testing Library       | `apps/web/tests`                                       |
| End-to-end | Playwright against a booted stack                | `e2e`                                                  |

Prefer test-first where the rules are subtle and the failure is silent — which
here means every access-control rule, conditional-visibility evaluation,
submission atomicity, and any scoring arithmetic.

Two operational traps:

- **Adding a table means adding it to the `TRUNCATE` list in both**
  `apps/server/test/harness.ts` **and** `e2e/db.ts`. Miss one and tests leak
  state between cases in an order-dependent way that wastes an afternoon.
- MSW runs with `onUnhandledRequest: "error"`. An unmocked endpoint fails loudly;
  add the handler in `apps/web/tests/msw/handlers.ts`.

Add new personas to `apps/server/test/fixtures.ts` rather than constructing users
inline, so every suite exercises the same set of adversaries.

---

## Secrets and applicant data

Non-negotiable, and the reason is that this system holds other students' essays.

- **Never commit real applicant data.** Fixtures are synthetic and structurally
  faithful. Copy the shape of the existing ones.
- **Never put a secret in a commit, an issue, a pull request, or a chat
  transcript.** Secrets live in OpenBao and Railway's variable editor, and
  nowhere else. **A secret that appears in a transcript has to be rotated** — so
  if it happens, say so immediately rather than hoping.
- No applicant names, emails, or response text in PostHog, Sentry breadcrumbs,
  log lines, URLs, or email payloads.
- Do not log full application payloads.

---

## If you are an agent

Everything above applies to you. Additionally:

- [`CLAUDE.md`](../CLAUDE.md) is loaded automatically and points at
  [`AGENTS.md`](../AGENTS.md). Read both.
- Do not widen scope on your own initiative. Finishing the task you were given
  beats half-finishing a larger one you invented.
- Where two readings of the spec lead to materially different work, ask. Do not
  pick one silently and build a week on it.
- The product rule in [`AGENTS.md`](../AGENTS.md) section 1 binds you more than
  anyone: the most natural thing for you to offer — summarizing or assessing
  these applications — is the thing this platform exists to not do. If a task
  seems to ask for it, say so rather than finding a compliant-looking way to do
  it.
