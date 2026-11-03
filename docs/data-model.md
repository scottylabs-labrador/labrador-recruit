# Data Model

The target schema, and the invariants the database itself enforces.

This is a specification, not a description of what is currently in
`packages/db/src/schema/`. The tree still holds the previous version's schema;
[`workstreams.md`](workstreams.md) says who builds which part of this, and
[`v1-baseline.md`](v1-baseline.md) maps the old tables onto the new ones.

**Rule for every table below:** a constraint that can live in the database lives
in the database. Application-level validation is a second line, not the first.
Postgres will still be enforcing these when every line of our TypeScript has been
rewritten.

---

## 1. Identity and organization

### `user`, `session`, `account`, `verification`

Better Auth's tables, carried over unchanged. `user.id` is the **Andrew ID** —
see [`authorization.md`](authorization.md) section 1 for why it is derived from
`full_email` and not `email`.

`account` doubles as the proposal's `auth_identities`: `provider_id` plus
`account_id` is the provider subject, and one user may hold several. No separate
table.

### `team`

A ScottyLabs committee, or a subteam of one. Global rather than per-cycle, so a
committee keeps its identity across seasons.

| Column           | Notes                                             |
| ---------------- | ------------------------------------------------- |
| `id`             | uuid                                              |
| `slug`           | unique, lowercase, hyphenated                     |
| `name`           | public display name                               |
| `description`    | shown on the committee card                       |
| `parent_team_id` | nullable self-reference; subteams                 |
| `active`         | soft retirement; never delete a team with history |
| `display_order`  | ordering on the landing page                      |

Invariants:

- `slug` is unique.
- `parent_team_id` must not create a cycle. Enforce depth or acyclicity in the
  service; Postgres will not do it for you.
- A grant on a parent team conveys **nothing** about a subteam, and vice versa.
  See [`authorization.md`](authorization.md) section 5.

### `permission_grant`

| Column       | Notes                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| `id`         | uuid                                                                   |
| `user_id`    | references `user.id`                                                   |
| `role`       | `org_admin` \| `committee_director` \| `question_editor` \| `reviewer` |
| `scope`      | `organization` \| `team`                                               |
| `team_id`    | null for organization scope                                            |
| `cycle_id`   | null for a cycle-independent grant                                     |
| `granted_by` | references `user.id`; revalidated at acceptance                        |
| `created_at` |                                                                        |
| `expires_at` | nullable                                                               |
| `revoked_at` | nullable                                                               |

Invariants:

- `CHECK ((scope = 'organization' AND team_id IS NULL) OR (scope = 'team' AND team_id IS NOT NULL))`
- A grant is **live** when `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`.
- Partial unique index on `(user_id, role, team_id, cycle_id) WHERE revoked_at IS NULL`,
  so the same live grant cannot exist twice. Note Postgres treats NULLs as
  distinct in a unique index, so organization-scope and cycle-independent grants
  need their own partial indexes — the previous version's
  `recruitment_membership` has worked examples of exactly this pattern, including
  the comment explaining why.
- **Never hard-delete a grant.** Set `revoked_at`. The history is the audit
  trail.

### `invitation`, `invitation_role`

| `invitation`  | Notes                                  |
| ------------- | -------------------------------------- |
| `id`          | uuid                                   |
| `email`       | intended recipient                     |
| `invited_by`  | references `user.id`                   |
| `team_id`     | null for organization scope            |
| `cycle_id`    |                                        |
| `token_hash`  | **a hash. The token is never stored.** |
| `expires_at`  |                                        |
| `accepted_at` | nullable                               |
| `revoked_at`  | nullable                               |

`invitation_role` is `(invitation_id, role)`, one row per requested role, so a
helper can be invited as question editor and reviewer at once.

Invariants:

- Unique index on `token_hash`.
- An invitation is **redeemable** when `accepted_at IS NULL AND revoked_at IS
NULL AND expires_at > now()`.
- Redemption is single-use: setting `accepted_at` is part of the same transaction
  that writes the grants.
- The accepting account's verified email must equal `email`.
- `invited_by`'s own authority is revalidated at acceptance time. See
  [`authorization.md`](authorization.md) section 6.

---

## 2. Cycles and openings

### `recruitment_cycle`

| Column                                 | Notes                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `id`                                   | uuid                                                                                              |
| `slug`                                 | unique                                                                                            |
| `name`                                 | `Spring 2027`                                                                                     |
| `description`                          |                                                                                                   |
| `status`                               | `draft` \| `scheduled` \| `open` \| `closed` \| `reviewing` \| `decisions_released` \| `archived` |
| `time_zone`                            | IANA name; deadlines are interpreted in it                                                        |
| `opens_at` / `closes_at`               | timestamptz                                                                                       |
| `max_committees_per_applicant`         | nullable; null means unlimited                                                                    |
| `require_preference_ranking`           | boolean                                                                                           |
| `review_opens_at` / `review_closes_at` | timestamptz, nullable                                                                             |
| `decisions_released_at`                | nullable; set by the release action                                                               |
| `created_by`                           | references `user.id`                                                                              |
| `created_at` / `updated_at`            |                                                                                                   |

Invariants:

- `slug` unique.
- `closes_at > opens_at` where both are set.
- Status transitions are legal only along the sequence in
  [`design.md`](design.md) section 6.2, validated by
  `packages/common/src/cycles/status.ts` and audited.
- `archived` makes the cycle read-only. Every write path checks it.
- **Deadlines are evaluated server-side against `now()`.** A browser clock is
  never the authority.

### `recruitment_opening`

One committee's participation in one cycle. This is the join that makes
multi-tenancy work — almost every scoped query reaches a team through here.

| Column                      | Notes                                                           |
| --------------------------- | --------------------------------------------------------------- |
| `id`                        | uuid                                                            |
| `cycle_id`                  | references `recruitment_cycle`                                  |
| `team_id`                   | references `team`                                               |
| `status`                    | `draft` \| `open` \| `closed` — independent of the cycle status |
| `opens_at` / `closes_at`    | nullable overrides of the cycle's window                        |
| `application_limit`         | nullable cap on accepted applications                           |
| `capacity`                  | nullable target number of members                               |
| `minimum_reviews`           | nullable override                                               |
| `created_at` / `updated_at` |                                                                 |

Invariants:

- Unique on `(cycle_id, team_id)`.
- An opening accepts submissions only when the cycle **and** the opening both
  say so. These two states are independent on purpose: the cycle can be `open`
  while a committee's form is not published yet.

---

## 3. Forms

The subsystem with no precedent to copy. Get the invariants right first.

```text
form  --<  form_version  --<  question
```

### `form`

| Column                  | Notes                                                |
| ----------------------- | ---------------------------------------------------- |
| `id`                    | uuid                                                 |
| `cycle_id`              | references `recruitment_cycle`                       |
| `team_id`               | **null for a common form**, set for a committee form |
| `opening_id`            | null for a common form, set for a committee form     |
| `kind`                  | `common` \| `committee`                              |
| `title` / `description` |                                                      |

Invariants:

- `CHECK ((kind = 'common' AND team_id IS NULL AND opening_id IS NULL) OR (kind = 'committee' AND team_id IS NOT NULL AND opening_id IS NOT NULL))`
- At most one `common` form per cycle: partial unique index on `(cycle_id) WHERE kind = 'common'`.
- At most one `committee` form per opening: unique on `(opening_id)`.

### `form_version`

| Column                      | Notes                                      |
| --------------------------- | ------------------------------------------ |
| `id`                        | uuid                                       |
| `form_id`                   | references `form`                          |
| `version`                   | integer, monotonic per form, starting at 1 |
| `status`                    | `draft` \| `published` \| `superseded`     |
| `created_by`                | references `user.id`                       |
| `published_at`              | null while draft                           |
| `created_at` / `updated_at` |                                            |

Invariants — these three are the heart of form integrity:

1. Unique on `(form_id, version)`.
2. **At most one `draft` per form**: partial unique index on `(form_id) WHERE status = 'draft'`.
3. **A published version is immutable.** No service updates a `form_version` or
   any of its `question` rows once `status = 'published'`. Editing means creating
   a new draft. This is what stops a director changing what a question meant
   after it was answered, and it is the invariant that `form_response` depends on
   to stay historically accurate.

Only a `committee_director` or `org_admin` publishes. A `question_editor` works
on drafts and cannot publish.

### `question`

| Column                 | Notes                                                           |
| ---------------------- | --------------------------------------------------------------- |
| `id`                   | uuid                                                            |
| `form_version_id`      | references `form_version`                                       |
| `question_key`         | **stable logical key**, unique within the version               |
| `type`                 | see below                                                       |
| `label`                |                                                                 |
| `description`          | help text                                                       |
| `required`             | boolean                                                         |
| `position`             | integer, ordering within the form                               |
| `config_json`          | jsonb: choices, min/max length, allowed MIME types, placeholder |
| `visibility_rule_json` | jsonb, nullable: structured conditional rule                    |

Types: `short_text`, `long_text`, `single_select`, `multi_select`, `dropdown`,
`number`, `url`, `file_upload`, `section_heading`, `static_content`.

Invariants:

- Unique on `(form_version_id, question_key)`.
- Unique on `(form_version_id, position)` — or renumber on reorder; either way,
  ordering is deterministic.
- `visibility_rule_json` is **structured data, never executable code**, and may
  only reference `question_key`s that appear **earlier in `position` order within
  the same version**. A rule that depends on a later answer, or on another form,
  cannot be evaluated during a single pass and must be rejected at publish time.
- `section_heading` and `static_content` are never `required` and never carry
  answers.

---

## 4. Applications

### `candidate_profile`

A person's participation in one cycle. The anchor the common response hangs off.

| Column                      | Notes                                   |
| --------------------------- | --------------------------------------- |
| `id`                        | uuid                                    |
| `user_id`                   | references `user.id`                    |
| `cycle_id`                  | references `recruitment_cycle`          |
| `common_locked_at`          | nullable; set on first final submission |
| `created_at` / `updated_at` |                                         |

Invariants:

- **Unique on `(user_id, cycle_id)`.** One profile per person per cycle.
- Once `common_locked_at` is set, common answers change only through the audited
  correction flow. See [`design.md`](design.md) section 7.1.

### `application`

One application to one opening. **This is the unit of review**, the unit of
decision, and the unit of committee scoping.

| Column                          | Notes                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                            | uuid                                                                                                 |
| `candidate_profile_id`          | references `candidate_profile`                                                                       |
| `opening_id`                    | references `recruitment_opening`                                                                     |
| `status`                        | `draft` \| `submitted` \| `under_review` \| `shortlisted` \| `interview` \| `decided` \| `withdrawn` |
| `preference_rank`               | nullable integer, the applicant's own ranking of this committee                                      |
| `submitted_at` / `withdrawn_at` | nullable                                                                                             |
| `idempotency_key`               | nullable, unique; guards duplicate submission                                                        |
| `created_at` / `updated_at`     |                                                                                                      |

Invariants:

- **Unique on `(candidate_profile_id, opening_id)`.** No duplicate applications
  to the same opening.
- Unique on `idempotency_key` where not null.
- `submitted_at IS NOT NULL` whenever status is past `draft`, except
  `withdrawn` from a draft.
- Status transitions validated by `packages/common/src/cycles/status.ts`; every
  transition writes an `application_status_event`.
- The applicant-visible status is a **projection** of this column, not the column
  itself. `shortlisted` surfaces to the student as `Under Review`. See
  [`design.md`](design.md) section 7.1.

The previous version's `committee_candidacy` concept collapses into this table:
an application _is_ the candidacy, because a student now applies directly to an
opening rather than having candidacies generated from a preference ranking.

### `form_response`

A set of answers to one form version.

| Column                      | Notes                                            |
| --------------------------- | ------------------------------------------------ |
| `id`                        | uuid                                             |
| `form_version_id`           | references `form_version`                        |
| `candidate_profile_id`      | set for a **common** response, null otherwise    |
| `application_id`            | set for a **committee** response, null otherwise |
| `status`                    | `draft` \| `submitted`                           |
| `revision`                  | integer; optimistic concurrency for draft writes |
| `submitted_at`              | nullable                                         |
| `created_at` / `updated_at` |                                                  |

Invariants:

- `CHECK ((candidate_profile_id IS NOT NULL AND application_id IS NULL) OR (candidate_profile_id IS NULL AND application_id IS NOT NULL))`
  — exactly one owner. The database constrains this, as the proposal requires.
- Unique on `(candidate_profile_id, form_version_id)` where the profile is set.
- Unique on `(application_id, form_version_id)` where the application is set.
- **A draft write must carry the `revision` it read.** The server rejects a stale
  revision with 409 rather than overwriting, and increments on success. This is
  what stops a second tab silently discarding newer edits.
- `status = 'submitted'` is terminal except through the correction flow.

### `answer`

| Column             | Notes                                      |
| ------------------ | ------------------------------------------ |
| `id`               | uuid                                       |
| `form_response_id` | references `form_response`                 |
| `question_id`      | references `question`                      |
| `value_jsonb`      | the answer; shape depends on question type |
| `updated_at`       |                                            |

Invariants — both of these are enforced in the database, not the service:

1. **Unique on `(form_response_id, question_id)`.** One answer per question per
   response.
2. **An answer's question must belong to the response's own form version.** The
   clean way to guarantee this is a composite foreign key: carry
   `form_version_id` denormalized on `answer`, add
   `FOREIGN KEY (form_version_id, question_id) REFERENCES question (form_version_id, id)`,
   and `FOREIGN KEY (form_response_id, form_version_id) REFERENCES form_response (id, form_version_id)`.
   Both parent tables need the matching unique indexes for this to be legal. Do
   it this way rather than with a trigger or a service-level check — the
   alternative silently permits an answer pointing at a question from a
   different committee's form.

Large files never go in `value_jsonb`. A `file_upload` answer stores a reference
to a `file` row. See section 7.

---

## 5. Reviews

### `rubric`, `rubric_criterion`

| `rubric`                    | Notes                            |
| --------------------------- | -------------------------------- |
| `id`                        | uuid                             |
| `opening_id`                | references `recruitment_opening` |
| `version`                   | integer, monotonic per opening   |
| `status`                    | `draft` \| `active` \| `locked`  |
| `created_by` / `created_at` |                                  |

| `rubric_criterion`                | Notes               |
| --------------------------------- | ------------------- |
| `id`                              | uuid                |
| `rubric_id`                       | references `rubric` |
| `name` / `description`            |                     |
| `minimum_score` / `maximum_score` | integers            |
| `weight`                          | numeric             |
| `position`                        |                     |

Invariants:

- Unique on `(opening_id, version)`; partial unique on `(opening_id) WHERE status = 'active'`.
- `maximum_score > minimum_score`.
- **A rubric locks once the first review against it is submitted.** A locked
  rubric and its criteria are immutable, for the same reason a published form
  version is: a submitted review scored against criteria that later changed is a
  review of something that no longer exists.
- Changing criteria mid-cycle means a new rubric version, and reviews reference
  the version they were scored against.

### `review_assignment`

| Column           | Notes                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| `id`             | uuid                                                                      |
| `application_id` | references `application`                                                  |
| `reviewer_id`    | references `user.id`                                                      |
| `assigned_by`    | references `user.id`                                                      |
| `status`         | `assigned` \| `in_progress` \| `submitted` \| `conflicted` \| `cancelled` |
| `assigned_at`    |                                                                           |
| `due_at`         | nullable                                                                  |

Invariants:

- **Partial unique index on `(application_id, reviewer_id) WHERE status <> 'cancelled'`.**
  Read that `WHERE` clause carefully: the previous version's index covered
  cancelled rows too, so reassigning a previously-cancelled reviewer returned 409. That is documented debt we are fixing here rather than inheriting. See
  [`v1-baseline.md`](v1-baseline.md).
- The service refuses an assignment whose `reviewer_id` is the applicant behind
  `application_id`. Self-review is a conflict of interest the visibility
  predicate would otherwise permit.
- The reviewer must hold a live `reviewer` (or director) grant for the opening's
  team and cycle. The assignment does not substitute for the grant; both are
  required.

### `review`, `review_score`

| `review`         | Notes                                                    |
| ---------------- | -------------------------------------------------------- |
| `id`             | uuid                                                     |
| `assignment_id`  | references `review_assignment`, unique                   |
| `rubric_id`      | references `rubric` — the version scored against         |
| `status`         | `draft` \| `submitted`                                   |
| `recommendation` | `strong_yes` \| `yes` \| `unsure` \| `no` \| `strong_no` |
| `confidence`     | `high` \| `medium` \| `low`, nullable                    |
| `comments`       | private to staff; never returned by a student endpoint   |
| `submitted_at`   | nullable                                                 |

| `review_score` | Notes                         |
| -------------- | ----------------------------- |
| `id`           | uuid                          |
| `review_id`    | references `review`           |
| `criterion_id` | references `rubric_criterion` |
| `score`        | integer                       |

Invariants:

- Unique on `assignment_id` — one review per assignment.
- Unique on `(review_id, criterion_id)`.
- `score` within the criterion's `minimum_score`..`maximum_score`, checked
  against the criterion row rather than a hardcoded range.
- A criterion must belong to the review's `rubric_id`. Same composite-foreign-key
  technique as `answer`.
- Submitting sets `submitted_at` and is what unblinds peer reviews for this
  reviewer on this application. A draft does **not** unblind. See
  [`authorization.md`](authorization.md) section 4.
- Post-submission edits are permitted until the review deadline and write audit
  events.

---

## 6. Decisions

### `application_status_event`

Every status change, forever. This table is the decision history.

| Column                      | Notes                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | uuid                                                                                                                      |
| `application_id`            | references `application`                                                                                                  |
| `old_status` / `new_status` | nullable old, for creation                                                                                                |
| `event`                     | `offered` \| `accepted` \| `declined` \| `confirmed` \| `rejected` \| `waitlisted` \| `shortlisted` \| `withdrawn` \| ... |
| `changed_by`                | references `user.id`; null for applicant-initiated                                                                        |
| `note`                      | internal, nullable                                                                                                        |
| `created_at`                |                                                                                                                           |

Invariants:

- Append-only. Never updated, never deleted.
- **An offer, an applicant's acceptance of it, and confirmation of membership are
  three separate events**, not three values of one status column. The
  organization may need that workflow and retrofitting it later would mean
  rewriting decision history.
- Written in the same transaction as the status change it records. A status that
  changed without an event is a bug.

Decision **release** is a cycle-level action: it sets
`recruitment_cycle.decisions_released_at` and enqueues notifications. Until then,
decisions are prepared and invisible to applicants. No cutoff ever applies
itself — see [`product-rules.md`](product-rules.md) section 1.

---

## 7. Files, notifications, audit

### `file`

| Column                        | Notes                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| `id`                          | uuid                                                          |
| `owner_user_id`               | references `user.id` — who uploaded it                        |
| `application_id`              | nullable; set once attached                                   |
| `object_key`                  | the R2 key. Opaque, not guessable, never a user-supplied name |
| `original_filename`           | for display only; never used as a path                        |
| `mime_type` / `size_bytes`    | validated at commit                                           |
| `status`                      | `pending` \| `committed` \| `rejected`                        |
| `created_at` / `committed_at` |                                                               |

Invariants:

- Unique on `object_key`.
- A `pending` file is not referenced by any submitted answer. Submission
  validates that every referenced file is `committed` **and owned by the
  submitting applicant**.
- Downloads are short-lived presigned GETs issued only after the backend has
  authorized that caller for that file. The object key is never a capability on
  its own — the bucket is private.
- `original_filename` is display text. Never join it to a path.

### `notification_outbox`

| Column                           | Notes                                                    |
| -------------------------------- | -------------------------------------------------------- |
| `id`                             | uuid                                                     |
| `template`                       | template identifier                                      |
| `recipient_email`                |                                                          |
| `payload_json`                   | **template variables only. No applicant response text.** |
| `status`                         | `pending` \| `sending` \| `sent` \| `failed` \| `dead`   |
| `attempts`                       | integer                                                  |
| `last_attempt_at` / `last_error` | nullable                                                 |
| `available_at`                   | timestamptz; backoff                                     |
| `created_at` / `sent_at`         |                                                          |

Invariants:

- Written in the **same transaction** as the domain event that causes it. That is
  the whole point: a failing email provider cannot fail a submission.
- `apps/worker` claims rows atomically (`FOR UPDATE SKIP LOCKED` or a status
  compare-and-set) so two worker instances cannot send the same email twice.
- `payload_json` carries no applicant content beyond what the recipient already
  holds. See [`product-rules.md`](product-rules.md) section 6.

### `audit_event`

| Column                        | Notes                                                                |
| ----------------------------- | -------------------------------------------------------------------- |
| `id`                          | uuid                                                                 |
| `actor_user_id`               | nullable for system actions                                          |
| `cycle_id` / `team_id`        | nullable scope                                                       |
| `action`                      | e.g. `grant.created`, `form_version.published`, `decisions.released` |
| `subject_type` / `subject_id` | what was acted on                                                    |
| `metadata_json`               | no applicant content                                                 |
| `created_at`                  |                                                                      |

Append-only. Must record, at minimum: permission changes, invitation creation and
acceptance, form publication, cycle transitions, decision changes, decision
release, sensitive exports, and administrative overrides.

**[author's call]** Audit read access is `org_admin` and, scoped to their own
team, `committee_director`. The previous version let any cycle member read the
audit log, which it flagged as possibly unintended; narrowing it is the safer
default and widening it later is easy.

---

## 8. Worked example

A student applies to Tech and Labrador in Spring 2027.

```text
user                       1   (id = their Andrew ID)
candidate_profile          1   (user_id, cycle_id) unique
form_response              1   common    -> candidate_profile_id, common form version
application                2   one per opening, (profile, opening) unique
form_response              2   committee -> application_id, that committee's form version
review_assignment          n   per application, independently
review / review_score      n   per assignment, independently
application_status_event   n   per application, independently
```

The Labrador director sees: the shared profile, the common response, the Labrador
application, the Labrador response, and Labrador's reviews and decisions.

They do **not** see: the Tech application, the Tech response, Tech's reviews, or
Tech's decisions. Probing a Tech application id returns **404**.

That separation is the point of the whole model. Every query that touches an
application reaches its team through `recruitment_opening`, and the compiled CASL
predicate narrows it to the openings the caller holds a live grant for.
