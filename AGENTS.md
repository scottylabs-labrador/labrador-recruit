# Agent Instructions

## Product rule that overrides everything

Never use an LLM or ML model to evaluate an applicant. Do not generate scores from essays,
infer traits from text, or fetch applicant-provided links. The platform organizes human
judgment; it does not supply judgment. Full rules in [`docs/product-rules.md`](docs/product-rules.md).

## Style

Follow the [ScottyStack Style Guides](https://github.com/ScottyLabs/ScottyStack/wiki/Style-Guides).

- `function foo() {}`, never `const foo = () => {}` — TanStack Router relies on hoisting.
- `camelCase` variables and functions, `SCREAM_CASE` constants, `PascalCase.tsx`,
  `camelCase.ts`, `kebab-case` for JSON filenames, folders, and assets.
- Branches are `username/feature-name`. Commits follow Conventional Commits.

## Architecture

Read [`docs/architecture.md`](docs/architecture.md) before adding a feature. The layering
contract is strict:

```text
packages/db/src/schema/*.ts       tables, relations, $inferSelect types
packages/access-control/src/*     CASL abilities — imports types only, never the db client
apps/server/src/services/*.ts     every drizzle query and every permission check
apps/server/src/controllers/*.ts  tsoa decorators only — no logic, no db access
apps/web/src/routes/*.tsx         TanStack Router; loaders prefetch, components read cache
```

Two-tier authorization, applied to every resource:

1. Read visibility compiles to SQL via `drizzleWhere(...)`, `and()`-ed into every query
   including the pre-checks for update and delete. Invisible rows return **404, not 403**,
   so existence is never leaked.
2. Mutation authority is a JS predicate (`canUpdateX({ user, x })`) checked after fetching
   the visible row, returning 403.

Never hand-write an ownership check like `eq(table.userId, user.id)`. Express it as a CASL
rule so the browser and the server enforce the same predicate.

## Verification

`bun run build:api` before typechecking or testing. `bun run check` is the full gate
(quality + tests + e2e). Never mark work complete without running it.

When adding a table, add it to the `TRUNCATE` list in **both**
`apps/server/test/harness.ts` and `e2e/db.ts`, or tests leak state between cases.

## Reference

The [ScottyStack demo branch](https://github.com/scottylabs-labrador/ScottyStack/tree/demo)
is the worked example for feature structure.
