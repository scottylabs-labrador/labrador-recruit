# API

Versioned under `/api/v1`. Routes are declared by tsoa decorators in
`apps/server/src/controllers/`; `bun run build:api` generates
`build/swagger.yaml`, `build/routes.ts`, and `build/swagger.d.ts`, and the web
app imports `paths` from the last of those.

Swagger UI is served at `/swagger`, and the raw document at `/openapi.json`.

---

## 1. Rules that apply to every route

**Authorization checks the requested resource, never an id supplied by the
client.** `GET /v1/teams/:teamId/applications` resolves the caller's live grants
for _that_ team from the database. A team id, cycle id, or application id in a
path, a query, or a body is an untrusted input and proves nothing.

**Invisible means 404, not 403.** A caller who may not see a resource gets 404,
so existence is never leaked. 403 is for "you can see it, you may not do that to
it".

**Status codes:**

| Code | Means                                                                   |
| ---- | ----------------------------------------------------------------------- |
| 401  | not authenticated                                                       |
| 403  | authenticated, visible, not permitted                                   |
| 404  | not found, **or** not visible to this caller                            |
| 409  | conflict: stale `revision`, duplicate submission, locked form or rubric |
| 422  | validation failed                                                       |

**Security decorators.** Every route carries `@Security(OIDC_AUTH)` and, where
an API token is meaningful, `@Security(BEARER_AUTH)`. A deliberately public route
carries a comment saying why. There are three public routes, all in section 2.

**Controllers contain no logic.** A controller declares the route, its request
shape, and delegates to a service. Permission checks live in the service, next
to the query they constrain.

---

## 2. Public

No authentication. These power the landing page before anybody signs in, so they
return only what a poster on a wall could say.

| Method | Route                | Returns                                                                              |
| ------ | -------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/v1/cycles/current` | the active cycle: name, description, opens/closes, time zone                         |
| GET    | `/v1/openings`       | committees recruiting in the current cycle: team name, description, status, opens_at |
| GET    | `/v1/health`         | liveness                                                                             |

No applicant data, no counts of applicants, no form contents.

---

## 3. Applicant

The caller is any authenticated CMU account. **Every route here is scoped to the
caller's own `candidate_profile` and nothing else** — there is no applicant route
that takes another person's id.

| Method | Route                              | Function                                                      |
| ------ | ---------------------------------- | ------------------------------------------------------------- |
| GET    | `/v1/me`                           | identity and the surfaces this account may reach              |
| GET    | `/v1/me/profile`                   | the caller's candidate profile for the current cycle          |
| PATCH  | `/v1/me/profile`                   | update profile fields                                         |
| GET    | `/v1/me/applications`              | the caller's applications with projected statuses             |
| POST   | `/v1/me/applications`              | create a draft application for an opening                     |
| GET    | `/v1/me/applications/:id`          | one application, with its response and answers                |
| PATCH  | `/v1/me/applications/:id/draft`    | save draft answers — **carries `revision`**                   |
| POST   | `/v1/me/applications/:id/withdraw` | withdraw                                                      |
| GET    | `/v1/me/common-response`           | the caller's common response for the cycle                    |
| PATCH  | `/v1/me/common-response/draft`     | save common draft answers — **carries `revision`**            |
| POST   | `/v1/me/submissions`               | finalize one or more applications — **atomic**                |
| GET    | `/v1/forms/:formId/published`      | the published form version for a form the caller may apply to |
| POST   | `/v1/files`                        | request a presigned upload                                    |
| POST   | `/v1/files/:id/commit`             | validate and commit an uploaded file                          |
| GET    | `/v1/files/:id/download`           | presigned, short-lived GET, after authorization               |

Notes that are requirements, not advice:

- **`PATCH .../draft` is optimistically concurrent.** The body carries the
  `revision` the client read. A stale revision returns **409** with the current
  revision in the body, so the client can tell the user their other tab is
  ahead. It never overwrites.
- **`POST /v1/me/submissions` accepts an idempotency key** and is one
  transaction implementing [`design.md`](design.md) section 9.2. It returns
  success only after commit. A repeat with the same key returns the same result
  rather than submitting twice.
- **`GET /v1/me/applications` returns projected statuses** — `Draft |
Submitted | Under Review | Interview | Decision Available | Withdrawn`. The
  internal status column is not exposed, and neither are scores, shortlist
  position, reviewer identities, or internal notes. This is enforced by which
  fields the service selects.
- `GET /v1/forms/:formId/published` is readable by an applicant only for an
  opening they could apply to in an open cycle. A draft version is never
  returned here.

---

## 3a. Invitations

Partly authenticated: a recipient has to be able to look at an invitation before
they hold any grant.

| Method | Route                           | Function                                                   |
| ------ | ------------------------------- | ---------------------------------------------------------- |
| GET    | `/v1/invitations/:token`        | what this invitation offers — team, roles, inviter, expiry |
| POST   | `/v1/invitations/:token/accept` | accept; writes the grants                                  |

The `GET` reveals nothing sensitive and does not consume the invitation. The
`POST` requires an authenticated session whose **verified email matches the
invitation's recipient**, revalidates the **inviter's** current authority, and is
single-use. See [`authorization.md`](authorization.md) section 6.

---

## 4. Committee director and staff

Team-scoped. The caller needs a live grant for the team and cycle in question.

| Method | Route                              | Minimum role                                           |
| ------ | ---------------------------------- | ------------------------------------------------------ |
| GET    | `/v1/teams/:teamId/dashboard`      | reviewer                                               |
| GET    | `/v1/teams/:teamId/applications`   | committee_director                                     |
| GET    | `/v1/applications/:id`             | committee_director, or reviewer **with an assignment** |
| GET    | `/v1/teams/:teamId/forms`          | question_editor                                        |
| GET    | `/v1/forms/:id/draft`              | question_editor                                        |
| PATCH  | `/v1/forms/:id/draft`              | question_editor                                        |
| POST   | `/v1/forms/:id/questions`          | question_editor                                        |
| PATCH  | `/v1/questions/:id`                | question_editor                                        |
| DELETE | `/v1/questions/:id`                | question_editor                                        |
| POST   | `/v1/forms/:id/reorder`            | question_editor                                        |
| POST   | `/v1/forms/:id/publish`            | **committee_director**                                 |
| GET    | `/v1/teams/:teamId/members`        | committee_director                                     |
| POST   | `/v1/teams/:teamId/invitations`    | committee_director                                     |
| DELETE | `/v1/invitations/:id`              | committee_director — revoke pending                    |
| DELETE | `/v1/grants/:id`                   | committee_director — revoke a helper                   |
| GET    | `/v1/openings/:openingId/rubric`   | reviewer                                               |
| PUT    | `/v1/openings/:openingId/rubric`   | committee_director                                     |
| POST   | `/v1/applications/:id/assignments` | committee_director                                     |
| DELETE | `/v1/assignments/:id`              | committee_director                                     |
| GET    | `/v1/applications/:id/reviews`     | committee_director, or an **unblinded** reviewer       |
| GET    | `/v1/applications/:id/aggregate`   | committee_director                                     |
| PATCH  | `/v1/applications/:id/status`      | committee_director                                     |
| POST   | `/v1/teams/:teamId/exports/:kind`  | committee_director — audited                           |

The distinctions that matter:

- **`POST /v1/forms/:id/publish` is a director power.** A question editor edits
  drafts and has no publish route. Gate it with `canPublishForm`, not a role
  string.
- **`GET /v1/applications/:id` serves two callers differently.** A director sees
  the application because they hold the team grant. A reviewer sees it because
  they hold an assignment. A reviewer without an assignment gets **404**, even
  with a reviewer grant for that exact team.
- **`GET /v1/applications/:id/reviews` is blinded.** A reviewer receives peer
  reviews only for applications where their own review is `submitted`. A draft
  does not unblind. See [`authorization.md`](authorization.md) section 4.
- **`PUT /v1/openings/:openingId/rubric` returns 409 once reviews have been
  submitted** against the active version. Changing criteria means a new version.
- **A question editor never has a route that returns an application.** Not a
  filtered one, not an anonymized one. None.

---

## 5. Reviewer

The reviewer's own queue. Scoped to their assignments, never to a team.

| Method | Route                                 | Function                                             |
| ------ | ------------------------------------- | ---------------------------------------------------- |
| GET    | `/v1/review/assignments`              | the caller's assignments with status and progress    |
| GET    | `/v1/review/assignments/:id`          | the application, read-only, plus the caller's review |
| PATCH  | `/v1/review/assignments/:id/draft`    | save review draft                                    |
| POST   | `/v1/review/assignments/:id/submit`   | finalize; **this is what unblinds peers**            |
| POST   | `/v1/review/assignments/:id/reopen`   | reopen before the deadline; audited                  |
| POST   | `/v1/review/assignments/:id/conflict` | declare a conflict of interest                       |

`GET /v1/review/assignments/:id` returns the applicant's submitted material and
the caller's own review. It does **not** return peer reviews — that is
`/v1/applications/:id/reviews`, and it is blinded.

---

## 6. Organization admin

Organization scope. The caller needs a live `org_admin` grant, except where
noted.

| Method | Route                                      | Function                                              |
| ------ | ------------------------------------------ | ----------------------------------------------------- |
| GET    | `/v1/admin/cycles`                         | all cycles                                            |
| POST   | `/v1/admin/cycles`                         | create — **global `admin` is sufficient** (bootstrap) |
| GET    | `/v1/admin/cycles/:id`                     | cycle configuration                                   |
| PATCH  | `/v1/admin/cycles/:id`                     | update configuration                                  |
| POST   | `/v1/admin/cycles/:id/transition`          | status transition; audited                            |
| POST   | `/v1/admin/cycles/:id/release-decisions`   | controlled release; audited; enqueues notifications   |
| POST   | `/v1/admin/cycles/:id/copy-from/:sourceId` | reuse forms, descriptions, rubrics as new drafts      |
| GET    | `/v1/admin/teams`                          | all teams                                             |
| POST   | `/v1/admin/teams`                          | create — **global `admin` is sufficient**             |
| PATCH  | `/v1/admin/teams/:id`                      | update, including `parent_team_id`                    |
| POST   | `/v1/admin/cycles/:id/openings`            | add a committee to a cycle                            |
| PATCH  | `/v1/admin/openings/:id`                   | opening status, window, limits                        |
| GET    | `/v1/admin/grants`                         | all grants, filterable                                |
| POST   | `/v1/admin/director-invitations`           | invite a committee director                           |
| GET    | `/v1/admin/analytics`                      | organization statistics — **no applicant identity**   |
| GET    | `/v1/admin/audit`                          | audit history                                         |

Two deliberate asymmetries:

- **`POST /v1/admin/cycles` and `POST /v1/admin/teams` accept the global `admin`
  role**, which comes from the Keycloak `labrador-recruit-admins` group. That is
  the bootstrap path: somebody has to create the first cycle before any grant can
  exist. Everything else on this list requires an `org_admin` grant, which an
  admin issues to themselves in an audited action. See
  [`authorization.md`](authorization.md) section 7.
- **`GET /v1/admin/analytics` returns aggregates only.** Counts, rates,
  distributions. No names, no emails, no response text. If a figure cannot be
  computed without identifying an applicant, it is not an analytics figure.

`POST /v1/admin/cycles/:id/release-decisions` is the only thing that makes a
decision visible to an applicant. Preparing a decision notifies nobody.

---

## 7. Shapes worth fixing now

Three request bodies that several workstreams depend on. Agree them early and
change them by ADR.

**Draft save** — both applicant draft routes:

```jsonc
// request
{ "revision": 7, "answers": [ { "questionKey": "why-labrador", "value": "..." } ] }
// 200
{ "revision": 8, "savedAt": "2026-11-03T22:41:00Z" }
// 409
{ "name": "Conflict", "message": "...", "currentRevision": 9 }
```

**Submission:**

```jsonc
// request
{ "idempotencyKey": "uuid", "applicationIds": ["uuid", "uuid"] }
// 200, after commit
{ "submitted": [ { "applicationId": "uuid", "submittedAt": "..." } ] }
// 422
{ "message": "Validation Failed", "missing": [ { "applicationId": "uuid", "questionKeys": ["..."] } ] }
```

**Presigned upload:**

```jsonc
// POST /v1/files  request
{ "filename": "portfolio.pdf", "mimeType": "application/pdf", "sizeBytes": 482910 }
// 200
{ "fileId": "uuid", "uploadUrl": "https://...", "expiresAt": "..." }
```

The `filename` is display text. The object key is generated server-side and is
never derived from it.
