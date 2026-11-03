# ScottyLabs Recruit — Design

**Status:** approved baseline, 3 November 2026
**Initial development target:** end of Fall 2026
**Target testing and rollout:** Spring 2027
**Supersedes:** the single-committee platform on `main` (see [`docs/v1-baseline.md`](v1-baseline.md))

This is the canonical description of what we are building and why. It is written
so that a developer — or an agent — who has never seen this repository can plan
work from it without asking anyone a question. If you are about to write code,
read this, then [`docs/architecture.md`](architecture.md), then
[`docs/product-rules.md`](product-rules.md).

Where a decision was made by the maintainers it says so. Where a decision was
made by whoever wrote this document it is marked **[author's call]**, so you know
it can be challenged cheaply.

---

## 1. What this is

ScottyLabs Recruit is a centralized recruitment management platform for
Carnegie Mellon's ScottyLabs organization.

Students apply to multiple ScottyLabs committees through one website. Each
committee independently controls its own application questions, recruitment
team, applicant evaluations, and decisions. The platform replaces the current
arrangement of separate Google Forms, spreadsheets, and manual tracking.

Labrador is the first committee to use it. **Every part of the system is built
for all committees from the start** — Tech, Design, Labrador, Events, Outreach,
Finance, and whoever else participates. Nothing may assume one committee.

There are three interfaces over one backend:

| Interface           | Who                                              | What they do                                |
| ------------------- | ------------------------------------------------ | ------------------------------------------- |
| Student Portal      | any CMU student                                  | browse committees, apply, track submissions |
| Committee Dashboard | committee directors, question editors, reviewers | build forms, manage applicants, evaluate    |
| Organization Admin  | the ScottyLabs Director and backups              | cycles, committees, directors, org settings |

### What changed from the previous version

The platform on `main` was built for Labrador reviewing its own applicants in
one cycle. Applications arrived as a spreadsheet export, there was no
student-facing surface at all, and authority came from a single Keycloak group.

This version inverts all three:

|            | Previous                    | This version                              |
| ---------- | --------------------------- | ----------------------------------------- |
| Applicants | imported from a form export | sign in and apply directly                |
| Tenancy    | one committee               | every committee, independently            |
| Forms      | one fixed question set      | per-committee dynamic form builder        |
| Authority  | Keycloak group membership   | database permission grants via invitation |
| Files      | none                        | private object storage                    |
| Email      | none                        | outbox plus worker                        |

The authorization _mechanism_ carries over unchanged and is the most valuable
thing we inherit. See section 5.

---

## 2. Core design principles

These are the commitments the architecture has to keep. A change that breaks one
is a defect even if it works.

1. **One portal for every committee.** No committee gets a special case in the
   code. If Labrador needs something, it becomes a configuration option
   available to all.
2. **One account per person.** A student applying to Design while reviewing for
   Labrador uses one account. Roles are additive and independently scoped.
3. **Common information once per cycle.** A student fills in the shared
   questions once, not once per committee.
4. **Committees own their questions.** A director changes their form without a
   code change, a deploy, or asking us.
5. **Permissions are granted, never asserted.** Access arrives through an
   invitation an authorized person issued, and is revocable.
6. **Writing questions, reviewing applications, and deciding outcomes are
   separate powers.** Holding one does not imply another.
7. **Cycles are immutable history.** A past cycle stays readable and cannot be
   mutated by anything happening in the current one.
8. **Authorization is enforced in the backend, in SQL.** The interface hiding a
   button is never the mechanism. See section 5.
9. **Applicant data is PII and is treated as such.** See
   [`docs/product-rules.md`](product-rules.md) section 6.
10. **No model judges an applicant.** See
    [`docs/product-rules.md`](product-rules.md) section 1. This rule overrides
    everything else in this document.

---

## 3. Decisions already made

These four were settled on 3 November 2026 and are not open. The reasoning is
recorded so a future reader does not reopen them by accident. Full records in
[`docs/adr/`](adr/).

### 3.1 Server: Express 5 + tsoa, not Fastify + ts-rest

The original proposal recommended Fastify and ts-rest. We keep
[ScottyStack](https://github.com/scottylabs-labrador/ScottyStack)'s stack
instead.

Why: ScottyStack is the ScottyLabs standard, so upstream fixes, the wiki, the
style guides, and Dependabot all keep applying. tsoa's generated OpenAPI
specification feeding `openapi-react-query` already delivers the shared
end-to-end TypeScript contracts the proposal asked for, so ts-rest would be
solving a solved problem. And we inherit the previous version's authentication
module, access-control layer, PGlite test harness, and Playwright stack boot
rather than rewriting them.

The cost, stated honestly: tsoa needs a codegen step, so `bun run build:api`
must run before the web app will typecheck. This trips up every fresh clone. It
is documented in three places for that reason.

### 3.2 Authentication: Keycloak for everyone

`idp.scottylabs.org/realms/labrador` has no local login form — its authorize
endpoint redirects straight to a single CMU SAML provider. **Every Andrew ID at
the university therefore authenticates successfully.**

The previous version treated that as a hazard and gated sign-in on the
`labrador-recruit` Keycloak group. For an applicant portal it is exactly the
feature we need: any CMU student can sign in, and we get a SAML-verified CMU
identity rather than a self-asserted email address.

So the group gate on sign-in is **removed**. A new person signs in, gets a user
row, and holds **zero** permissions. They can apply. They can see nothing
internal. All staff authority comes from `permission_grant` rows.

```text
Any CMU student
  -> Keycloak -> CMU SAML -> authenticated
  -> user row created, no grants
  -> can apply; can see nothing internal

Staff are the same user row, plus:
  + permission_grant(role, team, cycle)
  + review_assignment rows, for reviewers
```

Goldador keeps exactly one job in the new model: **bootstrap**. Membership of the
`labrador-recruit-admins` Keycloak group confers the global `admin` role, which
can create the first cycle and issue the first grants. It is the root of trust
and nothing else. That is what stops the system from needing a user in the
database before anybody can create one.

See [`docs/authorization.md`](authorization.md) for the full model.

### 3.3 The no-AI-evaluation product rule carries over unchanged

[`docs/product-rules.md`](product-rules.md) moves across intact, including the
narrow verbatim-GitHub carve-out, and `AGENTS.md` keeps it as the rule that
overrides everything.

It is already enforced architecturally — all scoring arithmetic lives in
`packages/common` as pure functions with no database or network access — so
carrying it costs nothing. It is settled ScottyLabs recruitment policy, not a
quirk of the previous version.

Note the specific trap. Proposal section 8.3 says "the system can compute a
summary or average score". That sentence is the exact place somebody will later
add a model. It computes arithmetic over human scores. Nothing else.

### 3.4 Deployment: Railway, with Cloudflare R2 for files

Railway, because that is what the previous version runs on and
`.railway/railway.ts` already encodes the infrastructure in code, including the
migration-in-entrypoint pattern. Railway also gives us a real long-running
process, which the email worker and the scheduled jobs need and which Vercel did
not provide.

Cloudflare R2 for applicant uploads: S3-compatible, no egress fees, and
`scottylabs.org` already sits behind Cloudflare.

```text
Railway project
  web       Caddy serving the Vite build        (public)
  server    Express + tsoa                      (private network)
  worker    email outbox drain                  (new)
  Postgres  + postgres-volume

Cloudflare R2
  private bucket, presigned GET/PUT
  object keys and metadata in the `file` table
```

---

## 4. Users and roles

Six distinct capabilities. One person may hold several, in several committees, in
several cycles, and the grants do not interact.

### 4.1 Student / applicant

Needs no grant. Any authenticated CMU account is an applicant.

May: view active cycles; browse committees accepting applications; read committee
descriptions and requirements; create and update their own applicant profile;
apply to one or many committees; answer common and committee-specific questions;
upload resumes and portfolios; save drafts; submit before the deadline; see their
own submission history and public status; withdraw where permitted.

May not: see any other applicant, any review, any internal status, or any
committee's internal data. **A student who also holds staff grants must not reach
their own application through the staff interface** — see section 5.5.

### 4.2 Director of ScottyLabs — global administrator

Scope: organization. Granted by the Keycloak admin group (bootstrap) or by
another organization administrator.

May: create and configure recruitment cycles; set organization-wide open and
close timestamps; choose participating committees; invite and appoint committee
directors; see recruitment progress across all committees; configure the
organization-wide common questions; manage global application settings; manage
and revoke staff permissions; oversee decision release; access platform-wide
analytics and authorized exports; archive completed cycles.

The platform supports a small number of trusted backup administrators so
leadership turnover does not lock anyone out.

### 4.3 Committee director

Scope: one team, one cycle. Granted by an organization administrator.

May, **for their own committee only**: access the committee dashboard; create and
modify committee-specific questions; preview and publish their form; invite
helpers; assign Question Editor and Application Reviewer grants; see applications
submitted to their committee; assign applications to reviewers; create and manage
rubrics; review, shortlist, and evaluate; update decisions; see committee
analytics; export authorized committee data; revoke helper grants.

May not: change global settings; see another committee's applications, answers,
or reviews; appoint directors for any committee, including their own.

### 4.4 Question editor

Scope: one team, one cycle. Granted by that committee's director.

May: see their committee's **draft** form; add, edit, delete, and reorder draft
questions; configure types, instructions, and validation; preview the form as a
student will see it.

May not: publish a form version; read any submitted application; see any review;
make any decision.

### 4.5 Application reviewer

Scope: one team, one cycle — **plus a per-application assignment**.

May: open applications explicitly assigned to them; read authorized applicant
information and answers; score against the rubric; leave private comments; submit
and update their review until the review deadline; see their own progress.

May not: see an application they were not assigned; edit questions; invite
anybody; make a final decision; see another reviewer's review before submitting
their own (see section 7.4).

The team grant alone is not sufficient. **A reviewer with a Labrador grant and no
assignments can read nothing.** Two independent conditions have to hold.

### 4.6 Holding several roles

A Labrador member may be a question editor and a reviewer in the same cycle. A
student may review for Labrador while applying to Design. The interface lets them
switch between the student and staff surfaces without a second account.

Every grant names its own team and cycle. A reviewer invited to Labrador for
Spring 2027 gains nothing in Tech and nothing in Fall 2027. Subteam grants are
explicit: holding a parent committee grant never exposes a subteam's applicants,
and vice versa.

---

## 5. Authorization

This section is the heart of the system. Read it before touching a service.

### 5.1 Two tiers, inherited from the previous version

Carried over from `main` unchanged in mechanism, because it works and because it
is what makes multi-tenancy safe.

**Tier 1 — read visibility compiles to SQL.** CASL rules are compiled into a
Drizzle `SQL` predicate by `drizzleWhere(ability, action, subject, table)` and
`and()`-ed into _every_ query that touches the table, including the pre-checks
performed before an update or a delete.

A row the caller cannot see yields **404, not 403**. Existence is never leaked. A
Design director probing `/admin/applications/<labrador-id>` learns nothing.

**Tier 2 — mutation authority is a predicate.** After fetching a row the caller
can see, the service calls `canUpdateX({ user, x })` and throws 403 on failure.
Creation is checked before any query runs.

Ownership is **never** written as a hand-rolled `eq(table.userId, user.id)`. It is
expressed as a CASL rule, so the identical predicate runs in the browser to gate
affordances and on the server to enforce them. One rule, one definition, two
enforcement points.

### 5.2 What the grants look like

```text
permission_grant
  user_id      who
  role         org_admin | committee_director | question_editor | reviewer
  scope        organization | team
  team_id      null for organization scope
  cycle_id     null for a cycle-independent grant
  granted_by   who issued it   (audited)
  created_at
  expires_at   null for no expiry
  revoked_at   null while live
```

A grant is live when `revoked_at IS NULL` and (`expires_at IS NULL` or
`expires_at > now()`). Revocation takes effect on the next request — there is no
cached permission state. **[author's call]** Reviewer grants default to expiring
with their cycle, per proposal section 4.3; renewal is an explicit act.

The database enforces valid scope combinations: `scope = 'organization'` requires
`team_id IS NULL`, and `scope = 'team'` requires `team_id IS NOT NULL`.

### 5.3 The bootstrap path

Somebody has to be able to act before any grant exists.

```text
Keycloak group `labrador-recruit-admins`
  -> groups claim
  -> global role `admin`
  -> may: create a cycle, create teams, issue permission_grants
  -> may NOT: read any applicant data
```

That last line matters and is inherited deliberately. A global ScottyLabs admin
is **not** automatically able to read applications. To read applicant data they
must grant themselves an `org_admin` permission grant, which writes an audit
event with their name on it. Bootstrapping and reading are different powers.

### 5.4 Invitations

Nobody is granted anything without an invitation they accepted.

```text
invitation
  email          intended recipient
  invited_by     who issued it
  team_id        null for an organization-scope invitation
  cycle_id
  token_hash     the token itself is never stored
  expires_at
  accepted_at
  revoked_at
+ invitation_role   one row per requested role (a helper may get both)
```

Requirements, all of them load-bearing:

- Tokens are cryptographically random and single-use.
- Only a hash of the token is stored. A database dump does not yield working
  invitations.
- Expiry is short and configurable.
- The accepting account's verified email must match the invitation's recipient.
- Acceptance is explicit. Clicking a link does not silently grant anything.
- Pending invitations can be revoked.
- Creation, acceptance, revocation, and every permission change write audit
  events.
- **The inviter's authority is revalidated at acceptance time.** An invitation
  issued by somebody whose own access has since been revoked grants nothing. This
  is the one that is easy to miss, and it is the whole reason `invited_by` is
  stored.

### 5.5 Applicant and staff separation

One account, two surfaces, and they must not leak into each other.

A committee director who is also applying to another committee reads their own
application through the **student** endpoints only. Staff endpoints resolve the
caller's grants and never fall back to "it is your own data, so sure". A reviewer
assigned — by accident or by malice — to their own application is a
conflict-of-interest case the assignment code refuses, not something the
visibility predicate happens to permit.

**[author's call]** The server refuses to create a `review_assignment` whose
reviewer is the applicant behind the application. It is a cheap check and the
alternative is discovering the gap during a real cycle.

---

## 6. Recruitment cycles

A cycle is one recruitment round: `Fall 2026`, `Spring 2027`, `Fall 2027`.
Created and managed by the ScottyLabs Director.

### 6.1 Configuration

Name and description; application open and close timestamps; participating
committees; the organization-wide common questions; the maximum number of
committees per applicant, if any; whether committee preferences or rankings are
required; per-committee application availability; review and decision timelines;
notification settings.

**All deadlines carry an explicit time zone and are evaluated server-side.** A
browser clock is never the authority on whether applications are open.

### 6.2 Statuses

```text
Draft -> Scheduled -> Open -> Closed -> Reviewing -> Decisions Released -> Archived
```

- **Draft** — administrators configure; directors prepare forms.
- **Scheduled** — configuration final, opening date in the future.
- **Open** — students can create and submit.
- **Closed** — new submissions disabled.
- **Reviewing** — committees evaluate.
- **Decisions Released** — approved outcomes become visible to applicants.
- **Archived** — historical and read-only.

Unlike the previous version, where status was cosmetic apart from `archived`,
**these statuses are enforced.** Submission checks the cycle status server-side.
A transition is an explicit, audited action.

Each committee's form additionally has **its own publication state**. The cycle
can be `Open` while a committee's form is still unpublished, and that committee
simply does not accept applications yet. These two states are independent on
purpose.

### 6.3 Reuse

A new cycle can copy question templates, committee descriptions, and rubrics from
a previous one. Copies become **new editable drafts owned by the new cycle**.
Previous applications and answers are never touched, and no copied object shares
a row with its source.

---

## 7. The product surfaces

### 7.1 Student portal

Routes and page contents are specified in detail in [`docs/ui.md`](ui.md). The
behavioural requirements that constrain the backend:

**Draft saving.** Autosave after a short idle period, plus a manual save, plus a
last-saved indicator, resumable from another device. Draft writes carry a
`revision` number and the server rejects a write whose revision is stale, so a
second tab cannot silently overwrite newer edits. The client surfaces the
conflict rather than discarding work.

**Common answers.** Filled once per cycle. The hard problem is that editing them
later would retroactively change applications already submitted. The MVP policy,
from proposal section 14.2: **common answers lock on the first successful final
submission**, and later changes require an authorized correction flow that writes
an audit event. A future release may snapshot per submission instead; the schema
is shaped so that is an addition rather than a migration.

**Submission.** Atomic. See section 9.2. The student sees a success confirmation
only after the transaction has committed.

**Tracking.** Students see `Draft | Submitted | Under Review | Interview |
Decision Available | Withdrawn` and nothing else. Reviewer scores, shortlist
position, and internal notes are invisible until an authorized release.

### 7.2 Dynamic form builder

The most important feature, and the one most likely to be built wrong.

A three-panel editor: a question-type toolbox, an ordered form canvas, and a
settings panel for the selected question. Reordering uses `dnd-kit`. A preview
mode renders the **same components the student sees** — not a mock of them.

Initial question types: short text, long text, single select, multi-select,
dropdown, number, URL, file upload, section heading, static instructions.

**Each question has a stable `question_key` and belongs to exactly one form
version.**

**Conditional visibility.** A rule is stored as **structured data, never as
executable JavaScript**. The same rule is evaluated by the renderer in the
browser and again by the submission validator on the server — one evaluator,
shared in `packages/common`, so the two cannot disagree. A hidden question is not
required, and answers to questions that ended up hidden are excluded from the
submitted response rather than quietly retained.

**Versioning.** A form starts as a mutable draft. Publishing creates an
**immutable `form_version`**. Students are served a published version and their
responses reference that exact version forever. Later edits create a new draft. A
director cannot change what a question meant after somebody answered it.

For the MVP, substantive edits lock once recruitment opens, except through a
controlled administrative correction. Serving old versions to in-flight applicants
while new applicants get a newer one is a later release; the schema already
supports it.

**Common and committee forms use one system.** A common form is owned by the
organization and scoped to the cycle; a committee form is owned by its director
and scoped to an opening. Same tables, same renderer, same validator. There is no
second code path.

### 7.3 Committee dashboard

Overview with live counts (submitted, awaiting review, reviewed, shortlisted) and
upcoming deadlines. An applicant table that is searchable, sortable, and
filterable by status, **with filters that survive navigating into an application
and back**. An applicant detail page that keeps the applicant's own submitted
material visually and structurally separate from internal evaluation notes.
Internal notes never reach the student portal — enforced by the endpoint, not by
the component.

### 7.4 Review system

Directors assign applications to reviewers. One `review_assignment` row per
reviewer-application pair. Manual assignment is enough for the MVP; automatic
workload balancing, conflict-of-interest declarations, and reviewer workload
dashboards come later.

Rubrics are configured per opening, with named criteria carrying a score range
and a weight. **Rubrics version and lock once reviews begin**, so the criteria
cannot change underneath reviews already submitted.

Reviews are independent: a reviewer does not see another reviewer's scores,
recommendation, or comments for an application until they have submitted their
own. This is the rule the previous version enforces in SQL via a resolved
`unblindedApplicationIds` set, and that technique carries over directly. See
[`docs/authorization.md`](authorization.md) section 4.

Post-submission edits are allowed until the review deadline and are audited.

### 7.5 Decisions

```text
Submitted -> In Review -> Shortlisted -> Interview (optional) -> Final Decision
```

Final decisions: offered, rejected, waitlisted. **[author's call]** An offer, the
applicant's acceptance of it, and confirmation of membership are modelled as
three distinct events on `application_status_event` rather than as one status
column, because the proposal flags that the organization may need that workflow
and retrofitting it later would mean rewriting decision history.

Directors prepare decisions **without notifying anybody**. Release is a separate,
explicit, audited organization-level action.

No numeric cutoff ever applies itself. See
[`docs/product-rules.md`](product-rules.md) section 1.

---

## 8. Notifications

Email is triggered by recruitment events and **must never be able to fail a
submission**.

Every send is written to `notification_outbox` inside the same transaction as the
event that caused it. A separate worker process drains the outbox, records
delivery attempts, and retries with backoff. A dead email provider delays
notifications; it does not lose applications.

Students receive: submission confirmation, deadline reminders if enabled,
interview invitations, decision release, and offer-acceptance confirmation. Staff
receive: director, question-editor, and reviewer invitations; application
assignment; review-deadline reminders; cycle opening and closure.

Templates are shared and consistently branded. **Private application content is
not included in email** beyond what the recipient already holds.

---

## 9. Data and consistency

The full schema, with every invariant, is in
[`docs/data-model.md`](data-model.md). The two things that are easy to get wrong:

### 9.1 Answer storage

Form definitions are relational rows with JSONB configuration. Answer values are
JSONB keyed to a versioned question row. This gives dynamic questions without a
column per question, while keeping referential integrity and historical accuracy.

Two constraints the database enforces, not the application:

- An answer's question must belong to the response's own form version.
- One answer per question per response.

### 9.2 Atomic submission

One transaction, in this order:

1. Authenticate the student.
2. Verify the cycle and the opening are accepting submissions — server clock.
3. Confirm the caller owns the application.
4. Load the correct **published** form versions.
5. Evaluate conditional rules, then validate every required **visible** answer.
6. Validate uploaded file references, including ownership.
7. Finalize responses and application statuses.
8. Write status events and outbox rows.
9. Commit.

Duplicate submissions are prevented by an idempotency key and a uniqueness
constraint, not by the button being disabled. A failure at any step leaves
nothing partially finalized.

### 9.3 Files

Large files never go in answer JSON. Uploads go to a private R2 bucket; the
database stores metadata and the object key. Size and MIME type are restricted,
uploads are scanned, ownership is verified, and downloads are short-lived
presigned URLs issued only after the backend has authorized the specific caller
for the specific file.

**[author's call]** Malware scanning in the MVP is MIME-type and magic-byte
validation plus a size cap, with a documented hook for a real scanner. A ClamAV
sidecar is a known follow-up, recorded in
[`docs/workstreams.md`](workstreams.md), rather than something quietly skipped.

---

## 10. API

Versioned under `/api/v1`. Full route table in [`docs/api.md`](api.md).

One rule that is not negotiable: **authorization checks the requested resource,
never a team id supplied by the client.** `GET /teams/:id/applications` resolves
the caller's grants for _that_ team from the database. A team id in a path, a
query, or a body is an untrusted input.

---

## 11. Technology

| Layer         | Choice                                  | Note                            |
| ------------- | --------------------------------------- | ------------------------------- |
| Monorepo      | Bun workspaces + Turborepo              | `packageManager` pins Bun 1.3.5 |
| Server        | Express 5, tsoa, Better Auth            | section 3.1                     |
| Worker        | Bun process draining the outbox         | new                             |
| Database      | PostgreSQL 17, Drizzle ORM              |                                 |
| Authorization | CASL compiled to Drizzle `WHERE`        | section 5.1                     |
| Web           | React 19, Vite, TanStack Router + Query |                                 |
| Forms         | React Hook Form + Zod, `dnd-kit`        | new, per proposal section 11    |
| Styling       | Tailwind v4, shadcn/ui                  |                                 |
| Files         | Cloudflare R2, presigned URLs           | new                             |
| Testing       | Vitest, PGlite, MSW, Playwright         |                                 |
| Deployment    | Railway, infrastructure in code         | section 3.4                     |

**[author's call] — TanStack Router, not React Router.** Proposal section 11
lists React Router. We keep TanStack Router because it is what ScottyStack and
the previous version use, its generated route tree gives typed params and typed
search params, and the filter-persistence requirement in section 7.3 is
materially easier with typed search state. This is part of "follow ScottyStack's
stack", which was the governing instruction.

React Hook Form, Zod, and `dnd-kit` are added as the proposal asks. The previous
version did not use React Hook Form; the form builder and the dynamic renderer
are the reason to adopt it.

---

## 12. Non-goals and anti-goals

**Not in this project:**

- Microservices. One deployable backend with internal module boundaries.
- Applicants from outside CMU. Authentication is CMU SAML through Keycloak.
- A mobile application. The student portal is fully usable on mobile web; the
  form builder and review dashboard may assume a desktop layout while staying
  basically accessible on small screens.
- Interview scheduling. The `Interview` status exists; coordinating calendars
  does not.

**Anti-goals — ways this could technically work and still have failed:**

- A model, a heuristic, or a cutoff that evaluates an applicant. See
  [`docs/product-rules.md`](product-rules.md) section 1.
- One committee able to read another's applications or reviews. This is the
  failure that ends the project's credibility, which is why section 5 is enforced
  in SQL rather than in components.
- A director able to change a question's meaning after it was answered.
- An aggregate whose derivation cannot be displayed.
- A submission that reports success without having committed.
- A form change that requires us to deploy.
- Applicant content in logs, URLs, analytics, or error payloads.

---

## 13. What is left to the builder

Deliberately unspecified, to be decided by whoever implements the workstream and
recorded in an ADR if the choice is load-bearing:

- The internal shape of the CASL subjects and actions for the new domain. The
  _mechanism_ is fixed (section 5.1); the vocabulary is not.
- Component composition inside each surface, beyond the component list in
  [`docs/ui.md`](ui.md).
- The conditional-rule expression format, as long as it is structured data, is
  evaluated by one shared evaluator, and round-trips through the builder UI.
- The outbox worker's retry and backoff policy.
- Analytics specifics beyond "no applicant identity leaves the backend".
- Whether the previous version's spreadsheet import and GitHub enrichment modules
  are carried forward. They are not on the MVP path now that students apply
  directly. **[author's call]** They stay in the tree, behind their existing
  flags, because migrating Fall 2026 data and onboarding a committee that still
  uses Google Forms are both plausible. They are explicitly not maintained unless
  somebody claims them.

---

## 14. Where to look next

| Document                                                | Contents                                              |
| ------------------------------------------------------- | ----------------------------------------------------- |
| [`AGENTS.md`](../AGENTS.md)                             | the rules every contributor and agent follows         |
| [`docs/architecture.md`](architecture.md)               | layering contract, request path, where code lives     |
| [`docs/product-rules.md`](product-rules.md)             | the no-AI-evaluation rule and privacy constraints     |
| [`docs/authorization.md`](authorization.md)             | the permission model in full                          |
| [`docs/data-model.md`](data-model.md)                   | every table and its invariants                        |
| [`docs/api.md`](api.md)                                 | the route table                                       |
| [`docs/ui.md`](ui.md)                                   | every page, route, and component                      |
| [`docs/workstreams.md`](workstreams.md)                 | how the work splits across developers                 |
| [`docs/local-development.md`](local-development.md)     | setup, secrets, database, troubleshooting             |
| [`docs/v1-baseline.md`](v1-baseline.md)                 | what the previous version is and what we take from it |
| [`.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md) | branch, commit, review, and merge process             |
