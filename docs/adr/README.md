# Architecture Decision Records

A record of decisions that would otherwise be reopened by accident, with the
reasoning and the costs we accepted.

## When to write one

Write an ADR when the decision is **load-bearing**: it changes the database
schema, the authorization model, the API shape, a product rule, or a dependency
other workstreams build against. Write it **before** building on top of the
decision, not after.

Do **not** write one for a local, reversible choice. Make it, and say in the
pull request that you made it. `docs/design.md` section 13 lists what is
deliberately left to the builder.

## Format

Number sequentially. Filename is `NNNN-short-kebab-title.md`. Keep it to one
page.

```markdown
# N. The decision, as a sentence

Date: YYYY-MM-DD

## Status

Proposed | Accepted | Superseded by [ADR-M](NNNN-....md)

## Context

What forced the decision. The constraint, the conflict, or the thing that broke.
Include what the alternatives were and who asked for what.

## Decision

What we are doing. Present tense, specific enough to check code against.

## Consequences

What this makes easier, and — more importantly — what it makes worse. State the
costs plainly. An ADR that lists only benefits is advocacy, not a record, and
the next person needs to know what you knew.

Name the alternatives you rejected and why, so they are not re-proposed from
scratch.
```

Superseding an ADR does not mean editing it. Write a new one, and change the old
one's status to point at it. The history of what we believed is part of the
record.

## Index

| #                                                                | Decision                                                               | Status   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| [0001](0001-keep-express-tsoa-over-fastify-ts-rest.md)           | Keep Express 5 + tsoa rather than adopting Fastify + ts-rest           | Accepted |
| [0002](0002-keycloak-for-everyone-and-grants-in-the-database.md) | Keycloak for everyone, with authorization in the database              | Accepted |
| [0003](0003-carry-over-the-product-rules.md)                     | Carry over the no-AI-evaluation product rules, add committee isolation | Accepted |
| [0004](0004-railway-and-cloudflare-r2.md)                        | Deploy on Railway, store applicant files in Cloudflare R2              | Accepted |

Decisions each workstream still owes an ADR for, from
[`workstreams.md`](../workstreams.md):

- **C** — whether password sign-in survives for local development, or is
  replaced by a seeded-session script.
- **B** — how a committee-scoped rule is compiled, given that a CASL condition
  targets one table and an application reaches its team through
  `recruitment_opening`.
- **L** — the email provider, and the retry and backoff policy.
- **M** — the origin layout: one public origin with Caddy proxying the API, or
  two hosts under `scottylabs.org`.
