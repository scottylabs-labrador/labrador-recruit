# The v1 Baseline

The git history before the `scottylabs-recruit` branch is a **different, working
product**. This document says what it is, what we take from it, what we leave,
and what it already got wrong so you do not pay for the same lesson twice.

Read it before you assume an existing file is where your new code belongs.

---

## 1. What v1 is

Labrador Recruit: an internal recruitment _review_ platform for ScottyLabs
leadership. One committee, one cycle. Applications arrived as a spreadsheet
export from a Google Form; reviewers scored them against a rubric; the platform
reported arithmetic over those scores.

It is **live and in use**. As of 4 September 2026 the Fall 2026 cycle held 118
applications, 378 candidacies, 9 reviewers, and 85 Labrador candidacies with two
assigned reviewers each. It runs on Railway in the `Labrador Recruiting` project,
at `recruit.scottylabs.org` with the API on `api.recruit.scottylabs.org`.

**Do not break it.** `main` keeps serving the current cycle. New work happens on
`scottylabs-recruit`, and the new deployment is a new Railway project with new
hostnames. See [`workstreams.md`](workstreams.md) workstream M.

It is 386 files and about 662 tests. The documentation on `main`
(`docs/handover.md`, `docs/deployment.md`, `docs/running-a-cycle.md`) is accurate
about v1 and is worth reading if you need to operate it.

---

## 2. What we take, unchanged

These are the reasons this branch starts from v1 rather than from ScottyStack.

**The authorization mechanism.** `packages/access-control/src/drizzle.ts` — the
CASL to Drizzle `WHERE` compiler — transfers directly and is the single most
valuable thing here. So does the shape of `abac.ts`, the 404-not-403 discipline,
and the `unblindedCandidacyIds` technique for cross-row rules. The subjects and
actions change; the mechanism does not. See
[`authorization.md`](authorization.md).

**Identity handling.** The `databaseHooks.user.create.before` hook that derives
`user.id` from the `full_email` claim rather than `email`, and the reasoning in
`lib/authConfig.ts`'s `signInEmail`. Read that comment before touching it — it
records two distinct real-world failures, one where a person was provisioned
under the wrong id and saw an empty application, and one where a person collided
with their own primary key and could not sign in at all.

**The test harness.** `apps/server/test/harness.ts` runs real migrations against
an in-process PGlite database, and `apps/server/test/setup.ts` seeds
`process.env` before any module that validates it is imported. `e2e/stack.ts`
boots a genuine stack — PGlite over a socket, the API, a built web app — for
Playwright. All of this works and would cost a week to rebuild.

**Error handling.** `middlewares/errorHandler.ts`, including the
`authErrors`-on-the-request pattern that returns the most relevant of several
authentication failures instead of whichever fired last.

**Tooling and CI.** oxlint, oxfmt, syncpack, husky, commitlint,
editorconfig-checker, the devcontainer, the Dockerfiles, the Caddyfile, and the
GitHub Actions gate. All of it stays.

**Pure-function discipline.** Scoring, aggregation, disagreement detection, and
ranking live in `packages/common` with no database or network access, and are
exhaustively unit tested in isolation. That is what makes
[`product-rules.md`](product-rules.md) section 2 enforceable rather than
aspirational. Keep it.

---

## 3. What we leave

**The sign-in group gate.** v1 refuses sign-in to anyone outside the
`labrador-recruit` Keycloak group, thrown from `mapProfileToUser`. Correct for an
internal review tool; fatal for a student application portal. It goes. See
[`design.md`](design.md) section 3.2.

**`AUTH_ALLOWED_GROUPS`.** Same reason. Goldador's only remaining job is deriving
the global `admin` role for bootstrap.

**Password sign-in, in production.** v1 has a full email-and-password path behind
the `not-yet-registered` sentinel in `AUTH_CLIENT_ID`, with
`PASSWORD_SIGN_IN=auto` as the cutover switch and `mustChangePassword` gating
every screen. It existed because no OIDC client was registered. One is now
registered and the DNS resolves, so it is not needed. Whether to keep a local-only
variant is workstream C's call, recorded in an ADR.

**`recruitment_membership`.** Superseded by `permission_grant`, which adds
`granted_by`, `expires_at`, `revoked_at`, organization scope, and the invitation
flow that issues it.

**`committee_candidacy`.** In v1, candidacies were _generated_ from an applicant's
submitted preference ranking — top N committees plus opt-ins. Students now apply
directly to openings, so an `application` **is** the candidacy. This collapses a
whole table and the generation rules with it.

**The import pipeline as the primary ingest.** `importService`, `headerMap`,
`parseWorkbook`, `normalizeRow`, and the Google Sheets sync exist because
applications arrived as spreadsheets. They now arrive through the portal. The
code stays in the tree behind its existing flags — migrating Fall 2026 data and
onboarding a committee that still uses Google Forms are both plausible — but it
is **unmaintained unless somebody claims it**, and it is not on the MVP path.

**GitHub enrichment.** Stays behind `GITHUB_ENRICHMENT`, unmaintained by default,
same reasoning.

**The Vercel deployment.** `vercel.json`, `api/index.ts`, and
`apps/server/src/vercelEntry.ts` are dead on Railway. Delete them in this branch.

---

## 4. Table mapping

| v1                                           | This version                             | Note                                                                                           |
| -------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `user`, `session`, `account`, `verification` | unchanged                                | `account` also serves as `auth_identities`                                                     |
| `user.role`, `user.mustChangePassword`       | likely dropped                           | depends on workstream C's password decision                                                    |
| `committee`                                  | `team`                                   | gains `parent_team_id` for subteams                                                            |
| `cycle_committee`                            | `recruitment_opening`                    | gains its own status, window, limits                                                           |
| `recruitment_membership`                     | `permission_grant`                       | plus `invitation`, `invitation_role`                                                           |
| `recruitment_cycle`                          | `recruitment_cycle`                      | gains `time_zone`, enforced statuses; loses the candidacy-generation and preference-map config |
| `applicant`                                  | folded into `user` + `candidate_profile` | applicants are now real accounts                                                               |
| `application`                                | `candidate_profile` + `application`      | one profile per cycle, one application per opening                                             |
| `question_definition`                        | `form` + `form_version` + `question`     | versioned and immutable once published                                                         |
| `application_answer`                         | `form_response` + `answer`               | responses name their form version                                                              |
| `committee_preference`                       | `application.preference_rank`            | the ranking is per application now                                                             |
| `committee_candidacy`                        | removed                                  | an application is the candidacy                                                                |
| `rubric`, `rubric_criterion`                 | kept, scoped to `opening_id`             | gains locking on first submitted review                                                        |
| `review_assignment`                          | kept                                     | **index fixed** — see section 5                                                                |
| `review`, `review_score`                     | kept                                     | `review` now names the rubric version                                                          |
| `committee_decision`, `final_placement`      | `application_status_event`               | offer, acceptance, confirmation as separate events                                             |
| `import_batch`, `import_row`                 | kept, demoted                            | unmaintained unless claimed                                                                    |
| `applicant_github_profile`                   | kept, demoted                            | unmaintained unless claimed                                                                    |
| `audit_event`                                | kept                                     | read access narrowed; see `data-model.md` section 7                                            |
| —                                            | `file`                                   | new                                                                                            |
| —                                            | `notification_outbox`                    | new                                                                                            |

**[author's call]** Workstream A writes **new** migrations for the new schema
rather than migrating v1's tables. The old deployment keeps its own database on
`main`, and nothing in the new one needs the old rows. Migrating a live schema we
are also restructuring would be strictly harder for no benefit.

---

## 5. Inherited debt — fix, do not repeat

Each of these is documented in v1's `docs/handover.md` and cost somebody real
time.

**The `review_assignment` unique index covers cancelled rows.** v1 has 255
cancelled assignment rows from an earlier redistribution, and because the unique
index on `(candidacy, reviewer)` includes them, reassigning a previously-cancelled
reviewer returns 409. **Fix:** partial unique index with
`WHERE status <> 'cancelled'`. Workstream A owns this.

**Scheduled work as `setInterval` in the server process.** The sheet sync and
GitHub refresh timers are started in `server.ts` and silently assume a single
replica. They also did nothing at all on Vercel, which has no long-running
process. **Fix:** `apps/worker` owns everything scheduled. Do not add a timer to
`apps/server`.

**Migrations in two places.** v1 briefly had both `docker-entrypoint.sh` and
Railway's `preDeployCommand` running `drizzle-kit migrate`, so the same migration
ran twice per deploy with two places to fail. Earlier still, a deploy ran
`drizzle-kit migrate` from a laptop behind a firewall that blocked outbound
Postgres; it exited 0 having applied nothing and the first request 500'd.
**Fix:** entrypoint only, with `set -e`.

**Audit log readable by any cycle member.** `listAuditEvents` reuses the cycle
read check, so a reviewer can see who exported decisions and who changed
settings. v1's own handover flags this as possibly unintended. **Fix:** narrowed
to `org_admin` and team-scoped `committee_director`.

**Cosmetic cycle status.** In v1, status does nothing except `archived`. Fall
2026 sat in `draft` while being actively reviewed. **Fix:** statuses are enforced
server-side here, and transitions are audited.

**Final placement with endpoints and no interface.** Built, unreachable, and
meaningless while the cycle was one committee. **Fix:** the multi-committee model
is the whole point now, so it gets a real surface in workstream J — or it is
explicitly cut, not left half-present.

**Backslashes through Git Bash into Railway variables.**
`ALLOWED_ORIGINS_REGEX` once became `web-production/.up/.railway/.app` because
Git Bash rewrote the backslashes, CORS then withheld the origin header, and only
a browser noticed. **Set anything containing a backslash from PowerShell or the
Railway UI.**

**`railway variables --unset` does not exist.** It is
`railway variable delete KEY --service <name>`.

**Both `AUTH_CLIENT_*` must always be strings.** `env.ts` requires them, so
`preserve()` on a variable that was never set leaves it `undefined` and the
server dies on its own environment validation _after_ migrating the database —
which looks like a database problem and is not one.

**`VITE_SERVER_URL` is read at build time.** Changing it needs a rebuild, not a
restart.

---

## 6. Two things v1's docs say that are no longer true

Both are stale in `main`'s `docs/handover.md` and `docs/deployment.md`. Verified
3 November 2026.

**DNS exists.** `recruit.scottylabs.org` and `api.recruit.scottylabs.org` both
resolve, to `exdvmgzs.up.railway.app` and `dv6qgqve.up.railway.app`.
`.railway/railway.ts` has `USE_SCOTTYLABS_DOMAIN = true` and
`AUTH_CLIENT_ID = "labrador-recruit-prod"`. The single-sign-on cutover happened.
`handover.md`'s "Outstanding" section still lists the missing DNS as blocking it.

**The Goldador secret-path bug is fixed.** Both v1 documents say Goldador derives
the OpenBao path with `split("-", client_id)[0]`, which collapses all four
`labrador-recruit-*` clients onto `labrador/generated/recruit`. Goldador's
current `infra/keycloak/outputs.tf` uses
`join("-", slice(parts, 0, length(parts) - 1))` for the slug and the last segment
for the environment, so `labrador-recruit/generated/{local,dev,staging,prod}` are
now the correct paths.

v1's `apps/server/secretspec.toml` still pointed at the old
`labrador/generated/recruit` item, so it was reading a stale secret. **That is
corrected on this branch.** If you are debugging v1's prod secret, this is why
reading it from the Keycloak admin console was the documented workaround and no
longer needs to be.

---

## 7. Keycloak clients and OpenBao paths available to you

Goldador's `teams/labrador-recruit.toml` has `create_oidc_clients = true`,
`website = recruit.scottylabs.org`, and `server = api.recruit.scottylabs.org`, so
all four clients exist:

| Client id                  | Redirect URI it accepts                                                       | Secret path                          |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------ |
| `labrador-recruit-local`   | `http://localhost/api/auth/{oauth2/,}callback/keycloak`                       | `labrador-recruit/generated/local`   |
| `labrador-recruit-dev`     | `https://dev.api.recruit.scottylabs.org/api/auth/{oauth2/,}callback/keycloak` | `labrador-recruit/generated/dev`     |
| `labrador-recruit-staging` | `https://staging.api.recruit.scottylabs.org/...`                              | `labrador-recruit/generated/staging` |
| `labrador-recruit-prod`    | `https://api.recruit.scottylabs.org/...`                                      | `labrador-recruit/generated/prod`    |

**`labrador-recruit-prod` is in use by the live v1 deployment.** Build against
`labrador-recruit-dev` and `labrador-recruit-local`. The prod client becomes ours
at cutover, not before.

Keycloak groups emitted in the `groups` claim: `labrador-recruit` (every member)
and `labrador-recruit-admins` (admins). Only the second one matters now — it
derives the global `admin` role for bootstrap. See
[`authorization.md`](authorization.md) section 7.

Adding somebody to the team is a Goldador change in
`teams/labrador-recruit.toml`, not a change here.
