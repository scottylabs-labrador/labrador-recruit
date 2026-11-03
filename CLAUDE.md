# CLAUDE.md

Claude Code reads this file automatically at the start of every session in this
repository.

## Read this first

**[`AGENTS.md`](AGENTS.md) is the contract.** Everything that governs how code is
written here lives there, and it applies to you identically. Read it before your
first edit. Sections 1, 3, 4, and 9 are the ones you cannot skip.

Then read [`docs/design.md`](docs/design.md) before starting any feature. It
states which of your defaults are wrong for this project, and there are several.

## The rule that overrides everything

**Never use an LLM or any ML model to evaluate an applicant.** No scores from
essays, no inference about a person from their text, no fetching
applicant-provided links, no automatic accept or reject including by numeric
cutoff. Full rules in [`docs/product-rules.md`](docs/product-rules.md).

This one binds you specifically and more than anyone. You are an LLM working on a
system that holds applicant essays, and the single most natural thing for you to
offer — "I could summarize these applications" — is the thing this platform
exists to not do. If a task seems to ask for it, stop and say so rather than
finding a compliant-looking way to do it.

## Before you claim anything works

```bash
bun run build:api     # ALWAYS first — generates types the web app imports
bun run quality       # oxfmt + oxlint
bun run test
```

Run the command. Read the output. Quote it. "This should pass" is not a result,
and a green claim that was never verified is worse than a red one that was. See
[`AGENTS.md`](AGENTS.md) section 4.

## Session workflow

**Starting work.** Check [`docs/workstreams.md`](docs/workstreams.md), confirm
which workstream the task belongs to, and stay inside its interface boundary.
Several people and agents are working in parallel; reaching into a neighbouring
layer is how merge conflicts and duplicate schemas happen.

**Planning.** For anything larger than a single-file change, plan before editing
and get the plan agreed. For anything that changes the schema, the authorization
model, the API shape, or a product rule, write an ADR in
[`docs/adr/`](docs/adr/) first.

**Debugging.** Find the root cause before proposing a fix. Do not add a
workaround on top of behaviour you have not explained. The previous version's
comments record several traps in detail — read the comment before assuming the
code is wrong.

**Finishing.** Run `bun run check`. Say explicitly what you verified and what you
did not. If part of the task is blocked, finish everything else and state plainly
what you left and why.

## Specific to this repository

- The git history before the `scottylabs-recruit` branch is the **previous
  single-committee product**. It is a quarry, not the target. Do not assume an
  existing file is where new code belongs. See
  [`docs/v1-baseline.md`](docs/v1-baseline.md).
- `@recruit/*` is the package scope. `@labrador/*` is stale.
- `labrador-recruit` is still correct for Keycloak client ids, Keycloak groups,
  and OpenBao paths — it is the Goldador team slug. Do not rename those.
- Authorization is the entire security boundary, because the Keycloak realm
  brokers to CMU SAML and every Andrew ID authenticates successfully. Never
  hand-write an ownership check; never trust an id from the client as proof of
  access. [`AGENTS.md`](AGENTS.md) section 3.
- Never commit real applicant data, and never put a secret in a commit, an
  issue, or a transcript. A secret that appears in a transcript must be rotated.
- `routeTree.gen.ts` is generated. Never edit it.

## Shared agent skills

Project skills are committed under [`.agents/skills/`](.agents/skills/) with
`skills-lock.json` pinning their sources. `.claude/` is gitignored — it is
machine-local scratch, so do not put anything there that another contributor
needs.
