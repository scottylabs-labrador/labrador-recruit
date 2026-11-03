---
name: Claim a workstream
about: Claim one of the parallel workstreams in docs/workstreams.md
title: "[workstream X] <name>"
labels: workstream
---

## Workstream

<!-- The letter and name from docs/workstreams.md, e.g. "E — Forms: schema, versioning, publish" -->

## Claimed by

<!-- Your GitHub username. Also add it to the table in docs/workstreams.md section 1. -->

## I have read

- [ ] [`AGENTS.md`](../../AGENTS.md) — sections 1, 3, 4, and 9
- [ ] [`docs/design.md`](../../docs/design.md)
- [ ] [`docs/product-rules.md`](../../docs/product-rules.md)
- [ ] My workstream's entry in [`docs/workstreams.md`](../../docs/workstreams.md)
- [ ] [`docs/authorization.md`](../../docs/authorization.md), if my work touches
      who can see what

## Definition of done

<!-- Copy the "Done when" line from your workstream entry, so this issue can be
     closed against something specific. -->

## Interface I expose

<!-- The types and functions other workstreams will build against. Agree these
     early; changing them later is the expensive kind of change. -->

## Stubs I need from neighbours

<!-- What you need that does not exist yet. Add the type and a stub to the
     package the neighbour owns, marked TODO(workstream-name), and link their
     issue here. Do not implement their layer in yours. -->

## Decisions that will need an ADR

<!-- Anything load-bearing: schema, authorization, API shape, a product rule, or
     a dependency others build against. Write the ADR before building on it. -->
