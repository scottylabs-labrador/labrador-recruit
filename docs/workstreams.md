# Workstreams

How the work splits so that several developers and agents can build in parallel
without colliding.

Each workstream has an **owner**, the **files it owns**, the **interface** it
exposes to its neighbours, and a **definition of done**. The rule is simple:

> You may freely change files your workstream owns. You may _read_ anything. To
> change a file another workstream owns, propose it — do not just do it.

**Claim your workstream before you start.** Put your name in the table in
section 1 and open a tracking issue. Two people independently building the forms
module produce two incompatible schemas and a day of merge pain.

---

## 0. How to work with a stub

Workstreams depend on each other, and they will not finish in order. When you
need something from a neighbour that does not exist yet:

1. Add the **type** to the shared package the neighbour owns, with a
   `TODO(workstream-name)` marker.
2. Add a throwing or empty-returning implementation next to it.
3. Build against the type.
4. Tell the owner in their tracking issue that a stub is waiting for them.

Do **not** implement the neighbour's logic in your own layer "temporarily". That
is how two sources of truth appear, and the one that is wrong is never the one
you remember to delete.

Everything below assumes [`AGENTS.md`](../AGENTS.md) section 3 — the layering
contract — and [`authorization.md`](authorization.md). Those are not optional in
any workstream.

---

## 1. The split

| #   | Workstream                            | Owner       | Depends on | Blocks        |
| --- | ------------------------------------- | ----------- | ---------- | ------------- |
| A   | Schema and migrations                 | _unclaimed_ | —          | everything    |
| B   | Authorization core                    | _unclaimed_ | A          | C, D, E, F, G |
| C   | Identity, invitations, grants         | _unclaimed_ | A, B       | D, G          |
| D   | Cycles, teams, openings               | _unclaimed_ | A, B       | E, F          |
| E   | Forms: schema, versioning, publish    | _unclaimed_ | A, B, D    | F, H          |
| F   | Applications: draft, submit, withdraw | _unclaimed_ | A, B, D, E | G, I          |
| G   | Reviews, rubrics, decisions           | _unclaimed_ | A, B, C, F | J             |
| H   | Form builder UI                       | _unclaimed_ | E          | —             |
| I   | Student portal UI                     | _unclaimed_ | E, F       | —             |
| J   | Staff dashboards UI                   | _unclaimed_ | C, D, G    | —             |
| K   | Files and object storage              | _unclaimed_ | A, B       | F, I          |
| L   | Notifications and worker              | _unclaimed_ | A          | C, F, G       |
| M   | Infrastructure and deployment         | _unclaimed_ | —          | —             |
| N   | Design system and shared components   | _unclaimed_ | —          | H, I, J       |

A and B are the critical path. **Nothing else should start until A has landed a
first migration and B has landed the ability builder**, because every other
workstream builds against those types. Expect to spend the first week with a
small group on A and B and everybody else reading [`design.md`](design.md).

---

## 2. Workstream detail

### A — Schema and migrations

**Owns:** `packages/db/**`

Build the target schema in [`data-model.md`](data-model.md). This is the highest
leverage and the highest blast radius work in the project.

Sequence it so other people can start:

1. `auth.ts`, `org.ts` (team, permission_grant, invitation) — unblocks B and C
2. `cycles.ts` (recruitment_cycle, recruitment_opening) — unblocks D
3. `forms.ts` — unblocks E
4. `applications.ts` — unblocks F
5. `reviews.ts`, `decisions.ts` — unblocks G
6. `files.ts`, `notifications.ts`, `audit.ts` — unblocks K and L

Specific things that are your job and nobody else's:

- Every `CHECK`, partial unique index, and composite foreign key in
  [`data-model.md`](data-model.md). **Especially** the composite keys that force
  an `answer`'s question to belong to its response's form version, and a
  `review_score`'s criterion to belong to its review's rubric. Those are the two
  places a cross-tenant leak can enter through the data layer.
- The partial unique index on `review_assignment` with `WHERE status <> 'cancelled'`.
  The previous version's index covered cancelled rows and returned 409 on
  legitimate reassignment. Do not inherit that.
- Migrating or deleting the previous version's schema. See
  [`v1-baseline.md`](v1-baseline.md) for the table mapping. **[author's call]**
  Start clean: write new migrations for the new schema rather than migrating the
  old tables, because the old deployment keeps running on `main` and nothing in
  the new database needs the old rows.
- A synthetic seed covering a full cycle: two committees, a common form, two
  committee forms, a dozen applicants, assignments, and reviews. Every other
  workstream will develop against your seed, so it is a deliverable, not a
  nice-to-have.

**Interface:** the `$inferSelect` types exported from
`packages/db/src/schema/index.ts`. Nobody imports a table from anywhere else.

**Done when:** `bunx drizzle-kit generate` produces a clean migration, the API
test harness migrates it from scratch, the seed runs, and every invariant in
[`data-model.md`](data-model.md) has a test that proves the constraint actually
rejects the bad row.

---

### B — Authorization core

**Owns:** `packages/access-control/**`, `apps/server/src/lib/accessControl.ts`,
`apps/server/src/lib/requestContext.ts`

Define the CASL subject and action vocabulary for the new domain and the ability
builder over it. The _mechanism_ is fixed by
[`authorization.md`](authorization.md); the vocabulary is yours.

Carry over directly, these are good: `drizzle.ts` (the CASL to Drizzle `WHERE`
compiler) and the shape of `abac.ts`.

Replace: `RecruitmentContext` becomes a grant-based context. Per request you
resolve the caller's live `permission_grant` rows, their assignment set, and
their `unblindedApplicationIds`.

Your hardest problem, and say how you solved it in your pull request: **every
scoped resource reaches its team through `recruitment_opening`.** A CASL
condition compiles against the columns of one table, so a rule about an
application's team has to either be expressed over a denormalized column on
`application` or combined with a second compiled predicate and an `and()`. Pick
one, write it down, and make everybody follow it. Inconsistency here is how a
leak gets in.

**Interface:**

```ts
getRequestUser(req): Promise<RequestUser>           // identity + global role
getScopedUser(req, cycleId): Promise<ScopedUser>    // + grants, assignments, unblinded
getAbility(user): Ability
drizzleWhere(ability, action, subject, table): SQL | undefined
canPublishForm({ user, form }): boolean             // and the rest of the can* family
```

**Done when:** the full negative-case matrix in
[`authorization.md`](authorization.md) section 9 passes, and
`packages/access-control` has no import of the db client.

---

### C — Identity, invitations, grants

**Owns:** `apps/server/src/lib/auth.ts`, `apps/server/src/lib/authentication.ts`,
`apps/server/src/services/{invitationService,grantService,userService}.ts`,
`apps/server/src/controllers/{invitationsController,grantsController}.ts`

Three jobs:

1. **Strip the sign-in gate.** The previous version refuses sign-in to anyone
   outside the `labrador-recruit` Keycloak group, in `mapProfileToUser`. Remove
   it. Any CMU account signs in and gets a row with no permissions. Keep the
   `full_email` handling exactly as it is — read the comment in `authConfig.ts`
   before you touch it, it records two real failures.
2. **Decide the fate of password sign-in.** The previous version has a full
   email-and-password fallback behind the `not-yet-registered` sentinel. We have
   a registered OIDC client and resolving DNS, so it is not needed in
   production. **[author's call]** Keep it for local development only, gated so
   it cannot enable itself in a deployment, or remove it and give local
   development a seeded-session script instead. Write an ADR for whichever you
   choose — this is an authentication surface.
3. **Build invitations and grants** to [`authorization.md`](authorization.md)
   section 6. The requirement most likely to be missed: **revalidate the
   inviter's authority at acceptance time.**

**Interface:** `getRequestUser` is B's, not yours. You own token issue, hash,
redeem, revoke, and grant lifecycle.

**Done when:** a CMU account with no grant can sign in and see nothing; an
invitation round-trips; a revoked inviter's pending invitation grants nothing;
every path writes an audit event; tokens are only ever stored hashed.

---

### D — Cycles, teams, openings

**Owns:** `apps/server/src/services/{cycleService,teamService,openingService}.ts`
and their controllers

Cycle lifecycle, team tree, and openings. The status machine lives in
`packages/common/src/cycles/status.ts` as a pure function — you own that file.

Non-obvious requirements:

- **Deadlines are server-side and time-zone explicit.** `recruitment_cycle`
  carries an IANA `time_zone`; comparisons use it; a client-supplied timestamp is
  never trusted for "are we open".
- An opening accepts submissions only when **both** the cycle and the opening
  say so. These are independent states.
- `archived` makes a cycle read-only, and every write path in every workstream
  has to honour it. Export a single `assertCycleWritable(cycleId)` helper so
  nobody reimplements the check.
- Cycle reuse copies forms, descriptions, and rubrics as **new draft rows owned
  by the new cycle**. No copied object shares a row with its source.
- `team.parent_team_id` must not form a cycle, and acyclicity is your check —
  Postgres will not do it.

**Done when:** every legal transition works, every illegal one is refused and
audited, archived cycles reject writes from every surface, and reuse produces
independent drafts.

---

### E — Forms: schema, versioning, publish

**Owns:** `apps/server/src/services/formService.ts`,
`apps/server/src/controllers/formsController.ts`,
`packages/common/src/forms/**`

The most important backend workstream. Three invariants you are the guardian of:

1. **A published `form_version` is immutable.** Nothing updates a published
   version or its questions. Editing creates a new draft. At most one draft per
   form.
2. **Conditional visibility is structured data with exactly one evaluator.**
   `packages/common/src/forms/visibility.ts` is used by the browser renderer
   (workstream H and I) and by the submission validator (workstream F). If there
   are ever two evaluators they will disagree, and the disagreement will be
   silent and will favour the attacker.
3. **A rule may only reference `question_key`s earlier in `position` order within
   the same version.** Reject anything else at publish time. A rule depending on
   a later answer cannot be evaluated in one pass; a rule crossing forms cannot
   be evaluated at all.

Also yours: answer validation against a question definition
(`packages/common/src/forms/validate.ts`), shared by the browser and the server
for the same reason.

**Interface:**

```ts
// packages/common/src/forms
evaluateVisibility(questions, answers): Set<QuestionKey>   // visible keys
validateAnswer(question, value): ValidationResult
validateResponse(questions, answers): ValidationResult     // required + visible
```

**Done when:** publishing freezes a version provably (a test that tries to mutate
a published question and fails); the evaluator is exhaustively unit tested
including nested and absent-answer cases; a publish-time check rejects a forward
reference; and the renderer and validator import the same function.

---

### F — Applications: draft, submit, withdraw

**Owns:** `apps/server/src/services/{profileService,applicationService,submissionService}.ts`
and their controllers

The transactional core. [`design.md`](design.md) section 9.2 is the submission
algorithm; implement it in that order, in one transaction.

The four things that will be got wrong if you are not deliberate:

- **Optimistic concurrency on draft writes.** A draft write carries the
  `revision` it read. A stale revision gets 409, not an overwrite. The client has
  to be able to tell the user their other tab is ahead.
- **Idempotent submission.** An idempotency key plus a unique constraint. Not a
  disabled button — a double-tap on a flaky connection must not create two
  submissions or send two emails.
- **Common-answer locking.** On the first successful final submission, set
  `candidate_profile.common_locked_at`. After that, common answers change only
  through the audited correction flow.
- **Validate only _visible_ required answers**, using E's evaluator, and exclude
  answers to questions that evaluated as hidden from the submitted response.

The success response is returned **after commit**. Never before.

**Done when:** a submission is atomic under an injected failure at each of the
nine steps; a duplicate submit is a no-op returning the same result; a stale
draft write 409s; hidden-question answers do not appear in the submitted
response; and an archived or closed cycle refuses submission.

---

### G — Reviews, rubrics, decisions

**Owns:** `apps/server/src/services/{rubricService,assignmentService,reviewService,aggregateService,decisionService}.ts`
and their controllers, plus `packages/common/src/reviews/**`

Rubric versioning, assignment, review capture, aggregates, and the decision
workflow.

Requirements with teeth:

- **A rubric locks on the first submitted review against it.** Same reasoning as
  form versions.
- **Independent review.** Implement the `unblindedApplicationIds` technique from
  [`authorization.md`](authorization.md) section 4. Only a **submitted** review
  unblinds; a draft does not.
- **Refuse self-assignment.** A `review_assignment` whose reviewer is the
  applicant is rejected by the service.
- **All aggregate arithmetic lives in `packages/common/src/reviews/` as pure
  functions.** This is [`product-rules.md`](product-rules.md) section 2: every
  aggregate must be reproducible by hand, and the interface must be able to show
  which reviews contributed and how. No model, no heuristic, no cutoff that
  applies itself.
- **Offer, acceptance, and confirmation are three `application_status_event`
  rows**, not three values of one column.
- Decision **release** is a separate cycle-level action that flips
  `decisions_released_at` and enqueues notifications. Preparing a decision
  notifies nobody.

**Done when:** a reviewer provably cannot read a peer review before submitting
(SQL-level test, not a UI test); a locked rubric rejects mutation; self-assignment
is refused; every aggregate has a unit test with hand-computed expected values;
and decisions are invisible to applicants until released.

---

### H — Form builder UI

**Owns:** `apps/web/src/components/form-builder/**`,
`apps/web/src/routes/admin.teams.$teamId.forms.tsx`

The three-panel editor from [`design.md`](design.md) section 7.2: question
toolbox, ordered canvas, settings panel. `dnd-kit` for reordering. React Hook
Form plus Zod for the settings panel.

Two hard requirements:

- **Preview mode renders the student components**, imported from
  `components/forms/` (workstream I owns those). Not a lookalike. A preview that
  can diverge from the real renderer is worse than no preview.
- **The conditional-rule editor produces structured data** that round-trips
  through `visibility_rule_json` and is evaluated by E's
  `evaluateVisibility`. You do not write a second evaluator to drive the preview.

A question editor sees drafts and has no publish affordance; the affordance is
gated by `canPublishForm` from workstream B, not by a local role check.

**Done when:** a director can build, reorder, configure, conditionally gate,
preview, and publish a form without touching the database, and the preview is
byte-for-byte the student experience.

---

### I — Student portal UI

**Owns:** `apps/web/src/components/{forms,applications}/**`, `apps/web/src/routes/{index,recruit,signin,app.*}.tsx`

Every student-facing route in [`ui.md`](ui.md). You own the **dynamic form
renderer** that H's preview and the real application both use — it is the most
reused component in the project, so its API matters more than its internals.

Requirements:

- **Fully usable on mobile.** This is the one surface where that is
  non-negotiable.
- **Autosave** after a short idle period, plus a manual save and a last-saved
  indicator. Handle the 409 from a stale revision by telling the user, not by
  discarding their work or silently clobbering the other tab.
- **Students see projected statuses only** — `Draft | Submitted | Under Review |
Interview | Decision Available | Withdrawn`. Never a score, a shortlist
  position, or an internal note. The endpoint should not return them; your job is
  to not ask for them and not display them if a future endpoint leaks them.
- Conditional questions are shown and hidden by E's evaluator.

**Done when:** a student can sign in, pick committees, complete the common form
once, complete per-committee forms, upload a file, resume from another device,
review, submit, and track — on a phone.

---

### J — Staff dashboards UI

**Owns:** `apps/web/src/components/{admin,reviews}/**`, `apps/web/src/routes/{admin.*,review.*}.tsx`

Committee dashboard, applicant list and detail, team management, reviewer queue
and review form, organization admin, analytics, audit.

Requirements:

- **Filters persist across navigation.** Going into an application and back must
  not reset the list. This is why we kept TanStack Router — put filter state in
  typed search params.
- **The applicant detail page separates the applicant's own submitted material
  from internal evaluation notes** structurally, not just visually. A reviewer
  should never be unsure which is which.
- **Every affordance is gated by a `can*` predicate from workstream B**, never by
  a local string comparison on a role. And remember that hiding the button is
  never the security mechanism — the server refuses regardless.
- The role switcher between student and staff surfaces, for people who are both.

**Done when:** each role sees exactly its own surface; a director of one
committee has no path to another's data; filters survive navigation; and the
reviewer queue shows a reviewer their own progress.

---

### K — Files and object storage

**Owns:** `apps/server/src/lib/storage.ts`,
`apps/server/src/services/fileService.ts`,
`apps/server/src/controllers/filesController.ts`,
`apps/web/src/components/forms/FileUploader.tsx`

The three-step presigned upload from [`architecture.md`](architecture.md)
section 7. Bytes go browser-to-R2 and never through the API.

Requirements:

- Private bucket. The object key is **not** a capability — a leaked key gets you
  nothing without a presigned URL the backend issued.
- Object keys are opaque and generated. **Never** derive a key from a
  user-supplied filename.
- Validate at commit: size cap, declared MIME type, and magic bytes.
- Downloads are short-lived presigned GETs issued only after authorizing that
  caller for that file.
- Submission validates that every referenced file is `committed` and owned by the
  submitting applicant.

Known gap, to be recorded rather than hidden: **real malware scanning is not in
the MVP.** Build the commit path with an explicit `scanFile` hook that currently
does magic-byte validation only, and open a follow-up issue for a ClamAV
sidecar. Do not describe the MVP as scanning uploads for malware.

**Done when:** an upload round-trips; a file owned by another user cannot be
attached; a presigned URL expires; a wrong-MIME upload is rejected at commit; and
the scanner hook exists with its limitation documented.

---

### L — Notifications and worker

**Owns:** `apps/worker/**`, `apps/server/src/services/notificationService.ts`,
email templates

A new app. Drain `notification_outbox`, send, record attempts, back off, mark
dead.

Requirements:

- **The enqueue happens inside the caller's transaction.** Expose
  `enqueueNotification(tx, ...)` that takes the transaction handle, so a service
  physically cannot enqueue outside one.
- **Claim rows atomically** — `FOR UPDATE SKIP LOCKED` or a status
  compare-and-set — so two worker instances never send the same email twice.
- **No applicant content in `payload_json`** beyond what the recipient already
  holds. See [`product-rules.md`](product-rules.md) section 6.
- The worker also owns anything scheduled. **Do not add a `setInterval` to
  `apps/server`** — the previous version did, and those timers silently assume a
  single replica.
- Pick the email provider and record it in an ADR.

**Done when:** a submission with a dead email provider still succeeds; a
transient failure retries with backoff and eventually sends; a permanent failure
goes `dead` with the error recorded; two workers do not double-send; and no email
carries applicant response text.

---

### M — Infrastructure and deployment

**Owns:** `.railway/**`, `apps/*/Dockerfile`, `apps/server/docker-entrypoint.sh`,
`apps/web/Caddyfile`, `.github/workflows/**`, `secretspec.toml` files

Stand up a **new** Railway project. Do not point this at the running
`Labrador Recruiting` project — the previous version is live and in use.

Specific work:

- A new Railway project with `web`, `server`, `worker`, Postgres, and a mounted
  volume, defined in `.railway/railway.ts`.
- Keep migrations in `docker-entrypoint.sh` with `set -e`, and **not** in
  `preDeployCommand`. Having both ran the same migration twice per deploy.
- Decide the origin layout. The previous version serves one public origin with
  Caddy proxying the API, because `up.railway.app` is on the Public Suffix List
  and sibling subdomains are cross-_site_, so Safari drops the session cookie.
  On `scottylabs.org` subdomains the two-service layout works. Both
  `recruit.scottylabs.org` and `api.recruit.scottylabs.org` currently resolve to
  the **old** deployment, so you need new hostnames —
  `dev.recruit.scottylabs.org` and `dev.api.recruit.scottylabs.org` are already
  registered as valid redirect URIs on the `labrador-recruit-dev` Keycloak
  client. Use that client while building.
- Wire the R2 bucket and its credentials through `secretspec`.
- Keep the CI gate green: editorconfig, markdownlint, syncpack, quality, test,
  e2e.

Secrets live in OpenBao and Railway's variable editor. Nowhere else, ever.

**Done when:** a push to the branch deploys all three services; migrations run
from the entrypoint; sign-in works end to end against the dev Keycloak client;
and `railway config plan` reports no drift on a clean checkout.

---

### N — Design system and shared components

**Owns:** `apps/web/src/components/ui/**`, `apps/web/src/styles.css`,
shared layout and navigation

The shared component inventory in [`ui.md`](ui.md): navigation, buttons, dialogs,
tables, search and filters, dropdowns, toasts, skeletons, empty states, error
pages, confirmation modals.

Requirements: consistent ScottyLabs branding; accessible colour contrast;
keyboard navigation throughout; clearly labelled form fields; mobile-responsive
layouts. shadcn/ui is the base — extend it rather than hand-rolling.

This workstream blocks H, I, and J in practice, so land the primitives early even
if the polish comes later. An agreed `StatusBadge` and `Table` on day three is
worth more than a perfect one in week five.

**Done when:** H, I, and J build their surfaces without writing their own
primitives, and a keyboard-only pass of the student flow works.

---

## 3. Sequencing

```text
Week 1        A (schema), B (authz core), N (primitives)
              everyone else: read design.md, authorization.md, data-model.md

Week 2        C (identity/grants), D (cycles/teams), M (infra), L (worker)
Week 3        E (forms backend), K (files)
Week 4        F (applications), H (form builder), I (student portal)
Week 5        G (reviews/decisions), J (staff dashboards)
Then          end-to-end hardening, accessibility pass, security review
```

This is a dependency order, not a schedule. The honest risk: **E, F, H, and I
together are more than half the project**, and the form builder plus dynamic
renderer pair is the piece most likely to need a second attempt. If something
slips, slip G's nice-to-haves (workload balancing, analytics depth) rather than
the form system.

---

## 4. Shared conventions

- Branches: `username/feature-name`. Rebase on `scottylabs-recruit` before
  opening a pull request.
- Conventional Commits. `deploy` is not a valid type.
- **One migration per pull request**, and say in the description which tables it
  touches.
- `bun run build:api` before any typecheck or test. Every time.
- Adding a table means adding it to the `TRUNCATE` list in **both**
  `apps/server/test/harness.ts` and `e2e/db.ts`.
- A pull request that changes who can see what says so in the description, in
  those words, so it gets the review it needs.
- Load-bearing decisions get an ADR in [`adr/`](adr/). Reversible local ones get
  a sentence in the pull request.

---

## 5. Follow-ups deliberately not in the MVP

Recorded here so they are visible debt rather than forgotten scope:

- Real malware scanning on uploads (workstream K) — ClamAV sidecar.
- Serving old form versions to in-flight applicants while new applicants receive
  a newer one (E). The schema supports it; the MVP locks instead.
- Per-submission snapshots of common answers (F). The MVP locks on first
  submission.
- Automatic reviewer workload balancing and conflict-of-interest declarations
  beyond the self-review check (G).
- Interview scheduling. The status exists; calendar coordination does not.
- Whether the previous version's spreadsheet import and GitHub enrichment are
  carried forward. They stay in the tree behind their flags and are
  **unmaintained unless somebody claims them**. See
  [`v1-baseline.md`](v1-baseline.md).
