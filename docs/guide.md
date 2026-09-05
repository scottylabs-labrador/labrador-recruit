# Recruit — the complete guide

What the platform is, how to use it, what it is built from, and how it works
underneath. If you only read one document, read this one.

To hand something to the team so they can start reviewing today, send them
[`start-reviewing.md`](start-reviewing.md). For the operational sequence of
running a cycle, see [`running-a-cycle.md`](running-a-cycle.md). For picking the
work up as an engineer, see [`handover.md`](handover.md).

## What it is

Recruit is the recruitment review platform for ScottyLabs. Applicants fill in
one Google Form for every committee. Leadership imports it, reviewers score
applicants against a rubric their committee published in advance, and the
platform reports arithmetic over those scores: means, medians, spreads, where
reviewers disagreed, and a ranking.

The one thing it does not do is judge anybody. Every subjective score comes from
a named human, and every number on screen can be reproduced by hand from the
reviews it summarises. That is not a preference — it is
[`product-rules.md`](product-rules.md), and a change that breaks it is a defect
however well it is written.

## Who can do what

Access is granted per cycle, so being an administrator of the infrastructure
gives you nothing until somebody enrols you, and that enrolment is audited.

| Role                | Scope          | Can                                                                                                   |
| ------------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| `reviewer`          | one committee  | Their queue, reviewing, declaring conflicts                                                           |
| `committee_lead`    | one committee  | All of the above, plus their committee's whole pool, aggregates, assignments, and recording decisions |
| `recruitment_admin` | the cycle      | All of the above, plus import, settings, memberships, exports, reopening reviews, final placement     |
| global admin        | the deployment | Create a cycle. Nothing else — no applicant data until they enrol themselves                          |

A reviewer reaches an applicant only through an assignment. A lead sees their
committee's pool. Nobody sees another committee's applicants.

## Using it

### Signing in

Andrew ID and password today, because no OIDC client is registered for this
deployment. The interface says so rather than offering a single sign-on button
that would fail at Keycloak.

Once a client is registered, the button appears, passwords stop working in the
same change, and access is decided by ScottyLabs team membership in Goldador.
The reasoning is in [`handover.md`](handover.md#how-people-sign-in).

### Setting up a cycle — recruitment admin

Everything here is a screen. Nothing needs a deploy or a script.

1. **Recruitment → Start a cycle.** A slug and a name. You land on Settings.
2. **Settings → Committees.** Add each committee by slug and name. The slug must
   match what the form's column headers use.
3. **Settings → Who may review.** Grant memberships by Andrew ID. People must
   have signed in once first, because a membership points at an account.
4. **Settings → Cycle settings.** Minimum reviews, how many ranked choices
   become candidacies, the disagreement threshold, and — if you are running one
   committee at a time — **Reviewing as**, which scopes every screen to it.
5. **Import**, or **Settings → Application source** to connect a Google Sheet.
6. **Rubric.** Publish one per committee before reviewing starts. A submitted
   review stays pinned to the version it was scored under.

### Reviewing — reviewer

**My Queue** is ordered so the applicants who matter most to your committee come
first. The Priority column says why:

| Label                      | Meaning                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `#1 + wrote`               | Ranked you first **and** answered your committee's questions |
| `#2 + wrote`, `#3 + wrote` | Ranked you second or third, and answered                     |
| `no response`              | Everyone else, ordered by the rank they gave you             |

"Wrote" means there is something to read, not that they ticked a box. Somebody
who opted in and left the boxes blank sorts with the no-response group.

Open a review and you get the application on the left and the rubric on the
right. Score each criterion, pick a recommendation and a confidence, and write a
rationale — that one is required, because other reviewers and leadership read it
and a score with no reasoning is not reviewable.

Two things worth knowing:

- **You cannot see anyone else's review until you submit your own.** This is
  enforced in SQL, not just hidden in the interface.
- **Declare a conflict** if you know the applicant. You are never asked why.

Drafts save as you go. Submitting locks the review; only a recruitment admin can
reopen it.

### Assigning — committee lead

Reviewers see only what they are assigned, so a committee does nothing until
somebody fills its queues. **Assignments** does that for the whole committee in
one pass: choose how many reviewers each applicant should get, **Preview
assignments** to see the plan named row by row, then confirm it. Nothing is
written until you confirm, and preview and apply are the same call with a flag —
what you approved is what gets written.

Re-run it whenever coverage changes. It only ever adds: nobody is unassigned, no
started review is touched, and a declared conflict is never undone. Load spreads
by _outstanding_ work across the whole cycle, so somebody already buried in
another committee is not handed a third pile. If an applicant cannot reach the
number you asked for, it says so by name rather than putting the same person on
them twice.

### Deciding — committee lead

**Ranking** orders the committee by score and shows the arithmetic beside each
row: how many reviews, mean, median, spread, the distribution of
recommendations, and any disagreement flag with its reason.

Record a decision per row, or select several and use the bar at the top. If the
cycle has admit or reject lines configured, they are drawn across the table and
**Select everyone above the admit line** selects them in one click.

Nothing is ever decided for you. The cutoff selects; a person confirms. Product
rule 1 forbids an automatic decision "including by numeric cutoff", and the code
follows it: each decision is written individually and audited to the person who
pressed the button. A bulk action that half-succeeded says so rather than
implying it all worked.

Deciding before a candidacy has its minimum reviews is allowed — sometimes a
committee already knows — but it asks first and tells you how many reviews are
missing.

### Reading disagreement

**Disagreements** lists candidacies where reviewers diverged, each with the
reason it was flagged: the spread exceeded the cycle's threshold, or two
reviewers landed on opposite extremes. It is a prompt to talk, not a verdict.

## Features in full

| Area                     | What it does                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Import**               | `.xlsx`/`.csv` upload or Google Sheet sync. Preview shows the column mapping, unrecognised and missing headers, and every failing row with the column at fault. One bad row never fails the batch. Committing is a separate, named act. |
| **Idempotent re-import** | Identity is cycle + normalised email. Re-importing updates rather than duplicates, adds missing candidacies, and never deletes a candidacy or touches a review. Unchanged rows are skipped outright.                                    |
| **Sheet sync**           | A cycle can name a Google Sheet. Manual **Sync now** or a schedule. Both stage a preview; neither commits.                                                                                                                              |
| **Candidacies**          | Created from an applicant's top-N ranked committees, plus any committee whose questions they answered if opt-ins are enabled.                                                                                                           |
| **Assignment**           | Reviewers assigned per candidacy, individually or by splitting a whole committee at once. Preview names every row before anything is written; re-running only adds, never undoes a conflict, and balances on outstanding work.          |
| **Queue priority**       | Four tiers, ranked choice crossed with whether they wrote anything for you.                                                                                                                                                             |
| **Blind review**         | Peer reviews withheld until you submit. Enforced in SQL.                                                                                                                                                                                |
| **Conflicts**            | Declared without a reason, in one confirmed step.                                                                                                                                                                                       |
| **Rubric**               | Per committee, versioned. Weighted criteria plus derived components (the applicant's own ranking) that reviewers see but cannot score.                                                                                                  |
| **Aggregates**           | Mean, median, min, max, spread, standard deviation, completion. Every one reproducible by hand.                                                                                                                                         |
| **Disagreement**         | Flagged on a configured spread threshold or extreme conflict, always with the reason.                                                                                                                                                   |
| **Ranking**              | Ordered by the configured formula, with the arithmetic shown beside each row.                                                                                                                                                           |
| **Decisions**            | Admit / waitlist / reject, per row or in bulk, with confirmation when short of reviews.                                                                                                                                                 |
| **Cutoff lines**         | Drawn on the ranking and offered as a selection. Never applied automatically.                                                                                                                                                           |
| **GitHub facts**         | Off by default. Verbatim repository facts for applicants who supplied a link — name, their own description, language, stars, last push. No summary, no score.                                                                           |
| **Exports**              | Ranking, decisions, reviewer load. The reviewer-load export deliberately carries no applicant data so it can be circulated.                                                                                                             |
| **Audit log**            | Every import, export, decision, membership change and settings change, with who and when.                                                                                                                                               |
| **Admin console**        | Cycle creation, committees, memberships, settings, sheet source, and — until single sign-on — issuing accounts.                                                                                                                         |

## Tech stack

| Layer         | Choice                                                               | Why                                                                                            |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Runtime       | **Bun**                                                              | One tool for install, run, test and bundling                                                   |
| Monorepo      | **Turborepo**                                                        | Caches builds and tests across the workspaces                                                  |
| API           | **Express 5** + **tsoa**                                             | tsoa generates the OpenAPI spec from the controllers, so the schema cannot drift from the code |
| Auth          | **Better Auth**                                                      | Keycloak via `genericOAuth`, plus email/password for a deployment with no identity provider    |
| Database      | **PostgreSQL** + **Drizzle ORM**                                     | Typed SQL that composes with the access-control predicates                                     |
| Authorisation | **CASL**                                                             | Abilities compiled directly into Drizzle `WHERE` clauses                                       |
| Interface     | **React 19**, **Vite**                                               |                                                                                                |
| Routing/state | **TanStack Router**, **Query**, **Form**                             | File-based routes, typed params, cache invalidation                                            |
| Styling       | **Tailwind v4** + shadcn-style primitives                            |                                                                                                |
| API types     | **openapi-typescript** → **openapi-fetch** → **openapi-react-query** | The client's types are generated from the server's spec                                        |
| Tests         | **Vitest**, **PGlite**, **MSW**, **Playwright**                      | Integration tests run against real Postgres in-process                                         |
| Lint/format   | **oxlint**, **oxfmt**, syncpack, markdownlint                        |                                                                                                |
| Hosting       | **Railway** (Docker), **Neon** Postgres                              |                                                                                                |

## How it works

### The request path

```text
Browser
  → openapi-react-query (types generated from the server's own spec)
  → Express + tsoa controller        validates the body against the OpenAPI schema
  → getRecruitmentUser(req, cycleId) resolves identity and this cycle's memberships
  → service                          enforces the rule, then queries
  → CASL ability → Drizzle WHERE     the caller's scope becomes part of the SQL
  → PostgreSQL
```

The important line is the last two. Authorisation is not a check that runs
before a query — it is compiled _into_ the query. A reviewer's SQL cannot return
another committee's applicants, because the predicate that limits them to their
own assignments is part of the statement. The same predicate
(`visibleApplicationWhere`) is exported and reused everywhere an application is
read, so there is one definition to be right about.

### How a score is computed

1. Each reviewer scores each rubric criterion on its scale.
2. Each criterion is normalised to 0–100 and multiplied by its weight.
3. Derived components — currently the applicant's own ranking — contribute their
   configured weight without any reviewer scoring them.
4. A reviewer's total is the weighted sum.
5. The candidacy's aggregate is the mean, median, min, max, spread and standard
   deviation across **submitted** reviews only. A draft never moves a ranking.

Every step is displayable, and the ranking page shows the inputs beside the
result. There is no score whose derivation the platform cannot show you.

### Data model, in one paragraph

A **cycle** runs **committees**. An **applicant** submits one **application**
per cycle, carrying **answers** keyed to **question definitions** and
**preferences** ranking the committees. A **candidacy** is one applicant
considered by one committee — the unit everything else attaches to.
**Assignments** put reviewers on candidacies; a **review** holds their scores
against a **rubric** version; **decisions** and **final placement** record the
outcome. Every mutation writes an **audit event**.

### Imports

The parser reads the workbook (choosing the worksheet that best matches the
expected headers, not simply the first), maps columns through a header map,
normalises each row, and stores every raw row verbatim so a commit never depends
on the file being re-uploaded. Commit is idempotent on cycle + normalised email,
runs one transaction per row, and skips rows whose content is unchanged since
the last commit for that applicant.

### The scheduled work

Two in-process timers, both off unless configured: the sheet sync stages
previews, and the GitHub refresher tops up cached facts within an hourly budget.
Neither can change applicant data on its own — the sync stops at a preview, and
GitHub data never feeds a score.

## Reference

### Screens

| Route                                            | Who                                               |
| ------------------------------------------------ | ------------------------------------------------- |
| `/recruitment`                                   | Anyone enrolled; cycle creation for global admins |
| `/recruitment/$cycleId`                          | Overview and progress                             |
| `/recruitment/$cycleId/queue`                    | Reviewer's own queue                              |
| `/recruitment/$cycleId/applicants`               | The pool the caller may see                       |
| `/recruitment/$cycleId/applicant/$applicationId` | One application                                   |
| `/recruitment/$cycleId/review/$assignmentId`     | Application beside the rubric                     |
| `/recruitment/$cycleId/assignments`              | Bulk reviewer assignment — leads and admins       |
| `/recruitment/$cycleId/ranking`                  | Ranking, decisions, cutoff lines                  |
| `/recruitment/$cycleId/disagreements`            | Flagged candidacies with reasons                  |
| `/recruitment/$cycleId/rubric`                   | Rubric editor — admins                            |
| `/recruitment/$cycleId/import`                   | Upload, preview, commit — admins                  |
| `/recruitment/$cycleId/exports`                  | Leadership                                        |
| `/recruitment/$cycleId/settings`                 | Admins                                            |

### Commands

```bash
bun install
bun run dev                              # api :8080, web :3000
bun run dev:login                        # local session (a script, never an endpoint)
bun run quality                          # syncpack, markdownlint, oxfmt, oxlint
bunx turbo run test                      # full suite
bun run build --filter=@labrador/server  # regenerate the OpenAPI client types
```

Changing a controller means regenerating the client types, or the web build
fails against a stale schema.

### Where things live

| Concern               | Path                                      |
| --------------------- | ----------------------------------------- |
| Controllers           | `apps/server/src/controllers/`            |
| Business rules        | `apps/server/src/services/`               |
| Import pipeline       | `apps/server/src/lib/import/`             |
| Column mapping        | `apps/server/src/lib/import/headerMap.ts` |
| Schema and migrations | `packages/db/`                            |
| Permissions           | `packages/access-control/src/abac.ts`     |
| Scoring and ranking   | `packages/common/src/recruitment/`        |
| Screens               | `apps/web/src/routes/`                    |
