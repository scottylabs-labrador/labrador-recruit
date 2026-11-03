# Authorization

The security boundary of this platform. Read it before touching a service, and
read it in full before changing who can see what.

The reason this document exists separately from
[`architecture.md`](architecture.md) is that the stakes here are not symmetrical
with the rest of the system. A broken form builder is an annoyance. One
committee reading another committee's applicants, or a reviewer reading a peer's
scores before submitting their own, is the failure that ends the platform's
credibility with the people who agreed to use it.

---

## 1. Authentication proves almost nothing

`idp.scottylabs.org/realms/labrador` has **no local login form**. Its authorize
endpoint redirects straight to a single CMU SAML provider. Consequently:

> Every Andrew ID at Carnegie Mellon authenticates successfully.

That is intentional and necessary — it is what makes a student application portal
possible at all. But it means a valid session tells you only that the caller is
_some_ CMU affiliate. It tells you nothing about what they may do.

**Authorization is therefore the entire security boundary.** There is no step
where "they got past the login" implies anything.

A new sign-in produces a user row and **zero** permissions. The person can apply
to things. They can see nothing internal.

### Identity

`user.id` is the **Andrew ID**, derived from the `full_email` JWT claim by a
Better Auth `databaseHooks.user.create.before` hook.

Not `email`. CMU lets people set an alias, and Keycloak's `email` claim is that
alias when one exists — `yh4@cmu.edu` rather than `yh4@andrew.cmu.edu`. Goldador
maps a second claim, `full_email`, straight from LDAP, and that one is always the
Andrew address.

This matters because the Andrew ID is the primary key every grant, assignment,
and review points at. Taking the alias produced two separate failures in the
previous version: somebody whose alias local part differed from their Andrew ID
was provisioned under the wrong id and saw an empty application, and somebody
whose alias local part matched collided with their own existing row and could not
sign in at all. Do not reintroduce this.

Better Auth's `account` table already holds what the proposal's `auth_identities`
table was for — `provider_id` plus `account_id` is the provider subject, and one
user may hold several rows. No additional table is required.

---

## 2. Three independent gates

Access to applicant data requires **all three**, not any one of them.

```text
Gate 1  authenticated          a valid session           -> you are some CMU person
Gate 2  a live permission_grant  role + team + cycle     -> you have standing here
Gate 3  resource reachability   assignment / ownership   -> you may see THIS row
```

Worked examples, because this is where mistakes happen:

| Caller                                   | Gate 1 | Gate 2       | Gate 3 | Result                                        |
| ---------------------------------------- | ------ | ------------ | ------ | --------------------------------------------- |
| CMU student, no grants                   | yes    | no           | —      | can apply; sees nothing internal              |
| Labrador reviewer, no assignments        | yes    | yes          | no     | **sees no applications**                      |
| Labrador reviewer, 12 assignments        | yes    | yes          | yes    | sees those 12                                 |
| Design director, Labrador application id | yes    | yes (Design) | no     | **404**                                       |
| Labrador director                        | yes    | yes          | yes    | all Labrador applications                     |
| Keycloak admin group, no grant           | yes    | no           | —      | can create cycles; **cannot read applicants** |
| Question editor                          | yes    | yes          | n/a    | draft form only; no applications ever         |
| Reviewer whose grant was revoked         | yes    | no           | —      | nothing, from the next request on             |

The third row is the one people get wrong. A team-scoped reviewer grant conveys
standing, not content. **Assignment is a separate, necessary condition.**

---

## 3. The two-tier mechanism

Inherited from the previous version unchanged, because it works.

### Tier 1 — read visibility compiles to SQL

```ts
const where = drizzleWhere(ability, "read", "Application", application);
const rows = await db
  .select()
  .from(application)
  .where(and(where, ...others));
```

`drizzleWhere` walks the CASL rules for an action and subject and compiles them
into a Drizzle `SQL` predicate. That predicate is `and()`-ed into **every** query
touching the table — including the read that precedes an update or a delete.

Three consequences, all deliberate:

1. **Invisible rows return 404, not 403.** Existence is never leaked. A Design
   director probing a Labrador application id learns nothing about whether it
   exists.
2. **Filtering is not a separate step you can forget.** The predicate is part of
   the query, so a list endpoint cannot accidentally return rows the caller
   should not see and then filter them in JavaScript.
3. **The same rules run in the browser.** `packages/access-control` imports types
   only and never the db client, so it bundles into the web app. The button is
   hidden by the same rule that refuses the request.

### Tier 2 — mutation authority is a predicate

```ts
const row = await getVisibleOr404(id, user);     // Tier 1 already applied
if (!canUpdateReview({ user, review: row })) throw new AuthorizationError(...);
```

After fetching a row the caller can see, a plain JS predicate decides whether
they may change it, and throws 403. Creation is checked up front, before any
query runs, because there is no row to fetch yet.

### What you must never write

```ts
// WRONG — a hand-rolled ownership check
.where(eq(application.candidateProfileId, user.profileId))

// WRONG — trusting an id from the client as proof of access
async function listApplications(teamId: string) { /* ...no grant lookup... */ }

// WRONG — filtering after the query
const all = await db.select().from(application);
return all.filter((a) => canRead(user, a));
```

The first duplicates a rule that already exists in CASL, so the two will drift.
The second treats a path parameter as authorization. The third loads rows the
caller may not see into process memory and into any error payload or log line
that touches them.

### Reuse, never restate

A visibility rule needed in more than one place is **exported and imported**.
`visibleApplicationWhere` in the previous version is the pattern. A second copy
of a visibility rule is a second place for it to drift, and that rule decides who
reads an applicant's essays.

---

## 4. Independent review — the cross-row rule

A reviewer must not see another reviewer's scores, recommendation, or comments
for an application before submitting their own.

This cannot be expressed as a column comparison, because it depends on the state
of a _different_ row — the caller's own review of the same application. The
technique, carried over from the previous version:

```text
per request, the server resolves:
  unblindedApplicationIds = applications where THIS caller has status 'submitted'

the ability builder then adds an ordinary condition:
  allow(["read", "readPeerReview"], "Review",
        { applicationId: { $in: unblindedApplicationIds } })
```

One extra query turns a rule SQL cannot express into an ordinary `$in` that
compiles alongside everything else. Only a **submitted** review unblinds; a draft
does not.

Directors and organization admins hold aggregate visibility, so they are never
blinded. Ordinary reviewers are blinded until they have submitted.

---

## 5. Grants

```text
permission_grant
  user_id      who
  role         org_admin | committee_director | question_editor | reviewer
  scope        organization | team
  team_id      null for organization scope, required for team scope
  cycle_id     null for a cycle-independent grant
  granted_by   who issued it   (audited, and revalidated — see section 6)
  created_at
  expires_at   null for no expiry
  revoked_at   null while live
```

**Live** means `revoked_at IS NULL` and (`expires_at IS NULL` or `expires_at >
now()`). Liveness is evaluated per request against the server clock. There is no
cached permission state and no session-embedded role list, so **revocation takes
effect on the next request**. Do not introduce a cache here without a deliberate
ADR; the immediate-effect property is a stated requirement.

The database enforces scope validity: `scope = 'organization'` requires `team_id
IS NULL`, `scope = 'team'` requires `team_id IS NOT NULL`.

### Role capabilities

| Role                 | Scope        | May                                                                                                            |
| -------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| `org_admin`          | organization | cycles, teams, common form, director grants, decision release, org analytics, archive                          |
| `committee_director` | team + cycle | committee form publish, applicants, assignments, rubrics, reviews, decisions, helper grants, committee exports |
| `question_editor`    | team + cycle | draft form read and write, preview                                                                             |
| `reviewer`           | team + cycle | assigned applications only, own review                                                                         |

And what each role explicitly may **not** do:

- `org_admin` may not read applicant data without also holding a grant that says
  so. See section 7.
- `committee_director` may not touch global settings, another committee's data,
  or appoint any director — including their own successor.
- `question_editor` may not publish a version, read any application, or see any
  review.
- `reviewer` may not read an unassigned application, edit a question, invite
  anybody, or decide an outcome.

### Subteams are explicit

`team.parent_team_id` models committees with subteams. A grant on a parent team
**does not** convey access to a subteam's applicants, and a grant on a subteam
does not convey access to the parent's. If somebody needs both, they hold two
grants. Inheriting applicant visibility down a tree is exactly the kind of
implicit widening this model exists to prevent.

---

## 6. Invitations

Nobody is granted anything they did not accept.

```text
invitation
  email          intended recipient
  invited_by     who issued it
  team_id        null for an organization-scope invitation
  cycle_id
  token_hash     the token itself is NEVER stored
  expires_at
  accepted_at
  revoked_at

invitation_role
  invitation_id
  role           one row per requested role
```

Requirements, every one of them load-bearing:

| Requirement                                                       | Why                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Cryptographically random token                                    | guessing a token must be infeasible                           |
| Single use                                                        | a forwarded link must not grant twice                         |
| Only `token_hash` stored                                          | a database dump must not yield working invitations            |
| Short, configurable expiry                                        | a link in an old inbox must stop working                      |
| Recipient email must match the accepting account's verified email | otherwise a forwarded link grants access to whoever opened it |
| Acceptance is explicit                                            | clicking a link must not silently grant anything              |
| Revocable while pending                                           | a mistaken invitation must be recallable                      |
| Audit events for issue, accept, revoke, and every grant change    | permission history must be reconstructable                    |

And the one that is easy to miss:

> **The inviter's authority is revalidated at acceptance time.**

An invitation issued by a director whose own grant has since been revoked or
expired **grants nothing**. Checking authority only at issue time means a
revoked director can keep handing out access by having sent the emails first.
This is the entire reason `invited_by` is a stored column rather than just an
audit detail.

---

## 7. Bootstrap

Somebody has to act before any grant exists, and the answer must not be "edit the
database by hand".

```text
Keycloak group `labrador-recruit-admins`   (managed in Goldador)
  -> `groups` claim on the access token
  -> global role `admin`
  -> may: create cycles, create teams, issue permission_grants
  -> may NOT: read any applicant data
```

Goldador has exactly one job in this system: **it is the root of trust, and
nothing else.** Adding somebody to the `labrador-recruit-admins` team in
Goldador's `teams/labrador-recruit.toml` makes them able to bootstrap. It does
not give them applicant access.

To read applicant data, a global admin must issue themselves an `org_admin`
permission grant, which writes an audit event with their name on it.
**Bootstrapping and reading are different powers, and the separation is
deliberate.** It means there is always a named, timestamped record of the moment
a person gave themselves access to student essays.

Note the contrast with the previous version: there, Goldador group membership was
checked at **sign-in** and gated the whole application. Here it is checked only
to derive the global role, and sign-in is open to all of CMU. If you find code
refusing a sign-in based on a `groups` claim, it is stale.

---

## 8. Applicant and staff separation

One account serves both. The surfaces must not leak into each other.

- A director applying to another committee reads their own application through
  the **student** endpoints. Staff endpoints resolve grants and never fall back
  to "it is their own data, so allow it".
- Internal reviewer notes and scores are returned only by staff endpoints. The
  student endpoints cannot return them, as a matter of which fields the service
  selects — not which fields the component renders.
- **The server refuses to create a `review_assignment` whose reviewer is the
  applicant behind the application.** A self-assignment is a conflict of
  interest, and the visibility predicate would otherwise happily permit it,
  because from SQL's point of view the reviewer genuinely is assigned.

Conflict-of-interest declarations more generally (a reviewer who knows an
applicant personally) are a later feature. The self-review check is the floor,
not the ceiling.

---

## 9. Testing authorization

A rule is not finished until a test proves the **denial** path. The cases that
must exist for every protected resource:

- unauthenticated — expect 401
- authenticated with no grant — expect 404 on read, 403 on write
- grant for a different team — expect 404, not 403
- grant for a different cycle — expect 404
- reviewer grant with no assignment — expect 404
- revoked grant — expect refusal on the very next request
- expired grant — expect refusal
- correct grant — expect success

The API suite runs real migrations against PGlite, so these are cheap to write
and fast to run. `apps/server/test/fixtures.ts` is where the personas live; add
to it rather than constructing users inline, so that every suite exercises the
same set of adversaries.

Negative tests are the deliverable here. A suite that only proves the happy path
proves that the feature works, not that it is safe.
