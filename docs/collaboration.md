# Collaboration

Two people build this, each with an agent, working in parallel on different
halves and merging continuously. This document is the coordination contract: who
owns what, where the two halves touch, and how work lands without the two of you
stepping on each other.

**If you are an agent joining this project, read this file and
[`docs/design.md`](design.md) before anything else.** This one tells you which
half of the system you are allowed to change; that one tells you what we are
building. [`AGENTS.md`](../AGENTS.md) tells you how to write the code.

---

## 0. Start here

|                | Track A — Apply                                                                                           | Track B — Review                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Entry point    | **[#33](https://github.com/scottylabs-labrador/labrador-recruit/issues/33)**                              | **[#34](https://github.com/scottylabs-labrador/labrador-recruit/issues/34)**                                     |
| Owns           | the form system and everything a student touches                                                          | who is allowed in, and everything after a submission arrives                                                     |
| Must guarantee | a question's meaning cannot change after it was answered; a submission either completes or did not happen | one committee never sees another's applicants; a reviewer never sees a peer's review before submitting their own |

Those two epics list each track's issues in dependency order, name the seams that
track owns, and say what it must not touch. **Open yours before you open the
code.** Every work item is a GitHub issue with its own context, requirements, and
definition of done — the issue is the specification, and
[`workstreams.md`](workstreams.md) section 1 is the index.

Milestones: **M0 Foundation → M1 Define → M2 Apply → M3 Review → M4 Harden**.
Section 5 says what each one has to demonstrate before either track moves on.

---

## 1. The two tracks

The system splits cleanly down one seam: **what an applicant touches** versus
**what the organization does with it.** They meet at three well-defined places
(section 3) and nowhere else, which is what makes parallel work possible.

### Track A — Apply

Everything a student sees, and the form system that drives it.

| Workstream        | What                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| Schema            | the initial migration and the forms/applications invariants                  |
| Forms backend     | `form`, `form_version`, `question`, publish, immutability                    |
| Conditional logic | the visibility evaluator and answer validation, in `packages/common`         |
| Applications      | draft, optimistic concurrency, withdraw                                      |
| Submission        | the atomic submit, idempotency, common-answer locking                        |
| Files             | R2 presigned upload, commit, download                                        |
| Form builder UI   | the three-panel editor, preview, conditional rule editor                     |
| Student portal UI | landing, sign-in, dashboard, committee selection, apply, review, submissions |

Track A's defining responsibility: **a question's meaning cannot change after
somebody answered it, and a submission either completes or does not happen.**

### Track B — Review

Who is allowed in, and everything that happens after a submission arrives.

| Workstream              | What                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| Authorization core      | CASL vocabulary, grant-based request context, the `WHERE` compiler        |
| Identity                | Keycloak for everyone, stripping the v1 sign-in gate                      |
| Invitations and grants  | tokens, acceptance, `permission_grant` lifecycle                          |
| Cycles, teams, openings | the status machine, the team tree, per-opening windows                    |
| Reviews                 | rubrics, assignments, review capture, blinding, aggregates                |
| Decisions               | the status workflow, offer/accept/confirm events, controlled release      |
| Staff dashboards UI     | committee dashboard, applicant list and detail, reviewer queue, org admin |
| Notifications           | the outbox worker and email templates                                     |
| Infrastructure          | the new Railway project, R2 bucket, CI, secrets                           |

Track B's defining responsibility: **one committee never sees another's
applicants, and a reviewer never sees a peer's review before submitting their
own.**

### Shared

Three things neither track owns alone, because both need them from day one:

| Shared surface                                | Rule                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/components/ui/**`, `styles.css` | add only the primitive you need, one small pull request, merge the same day |
| `packages/db/src/schema/enums.ts`, `index.ts` | append-only, alphabetical, so a conflict is trivially resolvable            |
| `docs/**`                                     | either track may correct any document; say so in the pull request           |

If a shared file is becoming a conflict magnet, that is a signal to split it, not
to coordinate harder.

---

## 2. Why this split and not another

The obvious split — one person does backend, one does frontend — is the wrong
one. The frontend person spends week one blocked, and every feature needs two
people to finish.

This split gives each track a **vertical slice it can ship end to end**: its own
tables, its own services, its own endpoints, its own screens, its own tests.
Either track can demo something working without waiting on the other.

The cost is that each person touches the whole stack and has to be comfortable in
all of it. That is the right trade for two people building something this size.

**Either track can take either half.** Swap if the other suits you better —
just say so before the foundation lands, because after that it gets expensive.

---

## 3. The seams

Three places the tracks touch. Each has a named owner and an agreed interface.
**Changing one of these is a conversation, not a commit.**

### Seam 1 — the authorization interface

**Track B owns. Track A consumes.**

```ts
// packages/access-control
getScopedUser(req, cycleId): Promise<ScopedUser>   // identity + live grants + assignments
getAbility(user): Ability
drizzleWhere(ability, action, subject, table): SQL | undefined
can<Action><Subject>({ user, ... }): boolean
```

Track A calls these; Track A never writes an authorization rule. If Track A needs
a rule that does not exist — "an applicant may read their own draft response" —
it is **requested from Track B**, not implemented in a service.

This is the seam most likely to be violated under time pressure, and the
violation is invisible until it is a leak. [`authorization.md`](authorization.md)
is the reference.

### Seam 2 — the form renderer

**Track A owns. Track B consumes.**

```tsx
// apps/web/src/components/forms
<DynamicFormRenderer
  questions={questions}      // from a published form_version
  answers={answers}
  mode="edit" | "readonly"   // Track B always uses "readonly"
  onChange={...}             // omitted in readonly
/>
```

Track B's applicant detail page renders an applicant's submitted answers with
this component in `readonly` mode. Track B does not build a second renderer, and
Track A does not change these props without telling Track B.

The same component also powers the form builder's preview, which is why a
lookalike is not acceptable — three surfaces, one renderer, no drift.

### Seam 3 — the application lifecycle

**Track A owns an application up to `submitted`. Track B owns it after.**

```text
Track A writes:   draft -> submitted        (and -> withdrawn from draft)
Track B writes:   submitted -> under_review -> shortlisted -> interview -> decided
```

Both write `application_status_event`, which is append-only, so there is no
contention. Neither track updates a status the other owns.

And one function across the seam, **Track B owns, Track A calls**:

```ts
// apps/server/src/services/notificationService.ts
enqueueNotification(tx, { template, recipientEmail, payload }): Promise<void>
```

It takes the transaction handle deliberately: a service physically cannot enqueue
outside a transaction, which is what guarantees a notification is never written
for an event that rolled back. Track A's submission calls this for the
confirmation email.

---

## 4. Branching and merging

Trunk-based on `scottylabs-recruit`, which is this project's trunk. **Do not
target `main` — that is the live v1 deployment.**

```text
scottylabs-recruit          trunk; always green, always deployable
  username/short-name       your branch; hours or a day or two, never a week
```

The rhythm:

1. Pull `scottylabs-recruit`. Branch.
2. Build one reviewable thing. Push early, even unfinished, as a draft pull
   request — it is how the other track sees what is coming.
3. Open the pull request. **The other track reviews it.** Both of you are the
   only reviewers, so a review that takes two days blocks half the project.
   Target: same day.
4. Rebase on trunk, merge, delete the branch.

**Merge daily, even when the feature is not done.** A branch that lives a week
will conflict with the schema, the route tree, the shared components, and the
generated OpenAPI types all at once. Land vertical slices behind an unfinished
screen rather than holding a complete feature back.

### The rules that prevent the painful conflicts

**One migration at a time.** `drizzle-kit generate` writes a journal and a
snapshot, and two concurrent migrations conflict in files nobody can
hand-merge. Before you run it, claim the slot by commenting on the schema issue.
Land it, then release the slot.

**Regenerate, never hand-edit, generated files.** `apps/server/build/**`,
`apps/web/src/routeTree.gen.ts`, and `packages/db/drizzle/meta/**` are all
generated. On a conflict, take trunk's version and regenerate:

```bash
bun run build:api
```

**`bun run build:api` after every pull.** A controller change on the other track
regenerates the API types, and your web app typechecks against the stale ones
until you do.

**One migration per pull request**, and name the tables it touches in the
description.

---

## 5. Milestones and merge gates

Five milestones. Each ends in a **gate**: a thing that demonstrably works, which
both tracks have to reach before either moves on. The gate is the point of the
milestone — it is what stops two half-finished halves from drifting into
something that never integrates.

| Milestone         | Gate: the thing that works                       | Track A                 | Track B       | Shared   |
| ----------------- | ------------------------------------------------ | ----------------------- | ------------- | -------- |
| **M0 Foundation** | both tracks boot, deploy, and share one schema   | #8, #9                  | #10, #11      | #12, #13 |
| **M1 Define**     | a director is invited, and publishes a form      | #17, #18                | #14, #15, #16 |          |
| **M2 Apply**      | a student applies end to end; a director sees it | #19, #20, #21, #22, #23 | #24           |          |
| **M3 Review**     | a reviewer reviews; a director decides           | #25                     | #26, #27, #28 |          |
| **M4 Harden**     | a full cycle runs on synthetic data              |                         | #29, #30      | #31, #32 |

M0 is the one with a real dependency: **#8, the initial migration, blocks
everything.** Track A lands it in the first few days; Track B reviews it closely,
because `permission_grant`, `invitation`, `recruitment_opening`, `rubric`, and
`review_assignment` are all Track B's tables, and a constraint missed there is one
they will be working around for months. While waiting, Track B does #11, which
needs nothing from anybody.

Two gates are issues in their own right, because they are checks rather than
features: **#31** (authorization against the full negative-case matrix) and
**#32** (accessibility and keyboard pass). Neither is a polish item. An applicant
who cannot complete the form cannot apply, and a committee that can read another
committee's applicants ends this platform's standing with the people who agreed
to use it.

Dates live on the GitHub milestones, not here, so there is one place to change
them.

---

## 6. GitHub as the coordination surface

Everything is an issue. If it is not an issue, the other track cannot see it and
your agent cannot find it.

### Labels

| Label                 | Meaning                                                 |
| --------------------- | ------------------------------------------------------- |
| `track-a` / `track-b` | which track owns it                                     |
| `shared`              | both tracks touch it; coordinate before changing        |
| `foundation`          | M0; blocks other work                                   |
| `gate`                | a milestone gate; closing it means the milestone is met |
| `seam`                | touches an interface between the tracks                 |
| `authorization`       | changes who can see what — gets the strictest review    |
| `schema`              | contains a migration; claim the migration slot first    |
| `needs-adr`           | a load-bearing decision is required before building     |
| `blocked`             | waiting on another issue; say which in a comment        |

### Conventions

- An issue is not started until it is assigned and its dependencies are closed.
  If you start anyway, say so in a comment so the other track knows.
- Put **decisions in comments on the issue**, not in chat. Chat is invisible to
  the other person's agent; an issue comment is context it will read.
- A pull request references its issue (`Closes #12`). Closing the issue by hand
  without a pull request means nobody can find how it was done.
- When you discover something the other track needs to know, comment on _their_
  issue. That is the cheapest possible handoff.
- `blocked` is not a status to sit in. Comment on what blocks you, then pick up
  something else.

---

## 7. Working with a stub

The tracks will not finish in dependency order. When you need something from the
other track that does not exist yet:

1. Add the **type** to the package **they** own, with a `TODO(track-b)` marker.
2. Add a throwing or empty-returning implementation next to it.
3. Build against the type.
4. Comment on their issue saying a stub is waiting.

**Do not implement their side in your layer, even temporarily.** That is how two
sources of truth appear, and the wrong one is never the one somebody remembers to
delete. A stub that throws is honest; a parallel implementation is a bug waiting
for a deadline.

---

## 8. For the agents

Both tracks run an agent. Some things only matter because of that.

**You are not the only agent in this repository.** Another agent is working the
other track against the same trunk. So:

- **Stay inside your track.** Before editing a file, check section 1. If it
  belongs to the other track, the move is to comment on their issue, not to
  change it. An agent that "helpfully" fixes the other track's code produces a
  conflict its human has to resolve without context.
- **Read the issue before the code.** The issue has the decisions; the code has
  only the result. Comments on the issue are the shared memory between two agents
  that never talk to each other.
- **Write what you learned back to the issue.** If you discovered that a library
  behaves unexpectedly, that a test is flaky, or that the spec was ambiguous —
  comment. The other agent will hit the same thing.
- **Pull and `bun run build:api` at the start of every session.** Your context is
  from last session; trunk is not.
- **Never claim a verification you did not run.** `bun run check` is the gate.
  Run it, read it, quote it. If part of it fails, say which part.
- **Load-bearing decisions get an ADR**, not an inline comment. Schema,
  authorization, API shape, product rules. See [`adr/README.md`](adr/README.md).

And the rule that overrides all of this: **never use a model to evaluate an
applicant.** You are an LLM working on a system that holds students' application
essays, and the most natural thing for you to offer — summarizing them,
assessing them, ranking them — is precisely what this platform exists to not do.
[`product-rules.md`](product-rules.md) section 1. If a task appears to ask for
it, say so rather than finding a compliant-looking way to do it.

---

## 9. Where to look

| Question                                          | Document                                       |
| ------------------------------------------------- | ---------------------------------------------- |
| What are we building?                             | [`design.md`](design.md)                       |
| How do I write code here?                         | [`AGENTS.md`](../AGENTS.md)                    |
| What may the platform never do?                   | [`product-rules.md`](product-rules.md)         |
| Who can see what, and how is it enforced?         | [`authorization.md`](authorization.md)         |
| What tables exist and what do they guarantee?     | [`data-model.md`](data-model.md)               |
| Where does code live?                             | [`architecture.md`](architecture.md)           |
| What are the routes?                              | [`api.md`](api.md), [`ui.md`](ui.md)           |
| What is the detailed work breakdown?              | [`workstreams.md`](workstreams.md)             |
| What is the previous version and what do we take? | [`v1-baseline.md`](v1-baseline.md)             |
| How do I run it?                                  | [`local-development.md`](local-development.md) |
| What was already decided, and why?                | [`adr/`](adr/)                                 |
