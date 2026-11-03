# 1. Keep Express 5 + tsoa rather than adopting Fastify + ts-rest

Date: 2026-11-03

## Status

Accepted

## Context

The ScottyLabs Recruit proposal, section 12, recommends a backend of Node.js,
TypeScript, Fastify, ts-rest, Zod, Drizzle, and PostgreSQL. It gives the
reasoning that a modular monolith is simpler to deploy, test, and maintain at the
scale of student recruitment, which we agree with and are doing.

But the stated governing instruction for this project was to follow
[ScottyStack](https://github.com/scottylabs-labrador/ScottyStack), ScottyLabs'
full-stack template, including its authentication mechanism. ScottyStack is
Express 5 with tsoa generating an OpenAPI specification, and the previous version
of this product is built on it.

These are mutually exclusive. The proposal's section 11 also asks for "shared
TypeScript API contracts wherever possible", which is the problem ts-rest exists
to solve and which tsoa already solves by a different route.

## Decision

Keep Express 5 and tsoa.

tsoa decorators on controllers generate `build/swagger.yaml`, which generates
`build/swagger.d.ts`, which `apps/web` imports through `openapi-fetch` and
`openapi-react-query` to get end-to-end typing. The contract the proposal asked
for already exists; it is produced by codegen rather than declared by hand.

## Consequences

Good:

- ScottyStack remains the upstream. Its wiki, style guides, Dependabot
  configuration, and any fixes it lands keep applying to us.
- We inherit, working, from the previous version: the Better Auth and Keycloak
  integration, the tsoa security model with two verification passes, the
  CASL-to-Drizzle access-control layer, the PGlite API test harness that runs real
  migrations, and the Playwright stack boot. Rewriting these on Fastify would cost
  weeks and would be strictly worse for a while.
- Every other ScottyLabs repository looks like this, so a contributor moving
  between projects is not relearning the backend.

Bad, and we are accepting it knowingly:

- **tsoa needs a codegen step.** `bun run build:api` must run before the web app
  will typecheck, because the generated types are gitignored. Every fresh clone
  hits this, and the symptom is dozens of unrelated-looking type errors. It is
  documented in `README.md`, `AGENTS.md`, `docs/architecture.md`, and
  `.github/CONTRIBUTING.md` for that reason.
- tsoa requires `experimentalDecorators`, and the project is pinned to a
  `7.0.0-alpha` release. That is upstream ScottyStack's choice and we follow it,
  but it is a known exposure.
- Express 5 is slower than Fastify. At the scale of a few hundred applicants per
  cycle this is not a consideration, and saying otherwise would be
  pretend-engineering.

If tsoa's alpha status becomes a real problem, the migration path is to ts-rest
on Express, which keeps the middleware, the auth module, and the test harness.
That is a much smaller change than moving framework and contract layer together.
