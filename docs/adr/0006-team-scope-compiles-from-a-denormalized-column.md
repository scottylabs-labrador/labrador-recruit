# 6. Team scope compiles from a denormalized column, guaranteed by a composite key

Date: 2026-11-09

## Status

Accepted

## Context

Authorization in this platform is the entire security boundary. The Keycloak
realm has no login form — it brokers to CMU SAML — so every Andrew ID at CMU
authenticates successfully, and a valid session proves only that the caller is
some CMU affiliate. See [`authorization.md`](../authorization.md) section 1.

Nearly every scoped rule is about a **team**: a Labrador director may read
Labrador's applications and no others. But almost nothing in the schema carries
a `team_id`. An application reaches its team through `recruitment_opening`:

```text
application.opening_id -> recruitment_opening.team_id
```

A CASL condition compiles against the columns of **one** table.
`drizzleWhere(ability, "read", "Application", application)` can only produce a
predicate over `application`'s own columns, and `team_id` is not one of them.

So a rule about an application's team must be expressed either over a
denormalized `team_id` on `application`, or as a second predicate combined with
`and()` at the call site. #10 names this as the decision that will cost most if
it is made inconsistently, because the two approaches fail differently and a
reviewer checking one will not notice the other.

## Decision

**Denormalize `team_id` onto every scoped table, and make drift impossible with
a composite foreign key rather than merely unlikely with discipline.**

For `application`:

```sql
ALTER TABLE application ADD COLUMN team_id uuid NOT NULL;

-- The parent key the composite FK points at.
ALTER TABLE recruitment_opening
  ADD CONSTRAINT recruitment_opening_id_team_key UNIQUE (id, team_id);

ALTER TABLE application
  ADD CONSTRAINT application_opening_team_fk
  FOREIGN KEY (opening_id, team_id)
  REFERENCES recruitment_opening (id, team_id);
```

Rules then read as ordinary conditions and compile through the existing
machinery untouched:

```ts
allow("read", "Application", { teamId: { $in: scoped.teamIds } });
```

`form` already carries `team_id`, so the form and form-version subjects need no
migration at all. Every scoped table added later follows this pattern.

## Why not a second predicate at the call site

This was the alternative, and it is the one that looks cheaper:

```ts
const where = drizzleWhere(ability, "read", "Application", application);
const rows = await db
  .select()
  .from(application)
  .innerJoin(recruitmentOpening, eq(application.openingId, recruitmentOpening.id))
  .where(and(where, inArray(recruitmentOpening.teamId, scoped.teamIds)));
//                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                 forget this line and the query returns every team's rows
```

It is rejected because of how it fails. **A developer who writes
`.where(drizzleWhere(...))` and omits the second predicate gets a query that
returns every committee's applications, and the call site looks correct.** It
reads like all the other call sites. It passes review. It passes any test whose
fixture has one team in it — which is most of them.

[`authorization.md`](../authorization.md) section 3 states the property this
would break, as a deliberate choice rather than a nicety: "filtering is not a
separate step you can forget. The predicate is part of the query, so a list
endpoint cannot accidentally return rows the caller should not see." A rule that
only half-compiles moves team scope from the predicate back into call-site
discipline, which is exactly what the two-tier mechanism exists to avoid.

The denormalization's weakness — a column that can disagree with its source — is
the one of the two that a database can simply eliminate.

## Why the composite key is the whole decision

A denormalized `team_id` maintained by application code is a leak waiting for
one careless insert: write the wrong `team_id` beside a correct `opening_id` and
a row becomes visible to the wrong committee, silently and permanently. That is
a worse failure than the one we are avoiding.

The composite foreign key removes the possibility. `(opening_id, team_id)` must
match a real `(id, team_id)` pair in `recruitment_opening`, so a mismatched pair
is not a bug to be found in review — it is a row Postgres refuses.

This pattern is already used twice in this schema: `answer` closes the loop
between its response and its question with two composite foreign keys. Both
traps are already documented there and both apply here:

- **The parent key must be `unique()` the constraint, not `uniqueIndex()`.**
  Drizzle emits constraints inline in `CREATE TABLE` but _all_ foreign keys
  before _any_ index, so a composite FK pointing at a `uniqueIndex` fails at
  migration time. This cost two rounds on `answer` and `review`.
- `recruitment_opening.id` is already the primary key, so `UNIQUE (id, team_id)`
  is trivially satisfied and costs an index we will use for this join anyway.

## Consequences

**Both tracks follow this.** A new scoped table carries `team_id` with a
composite foreign key back to whatever row establishes its team, and its CASL
rules compile from that column. Reviewing a new scoped table means checking the
constraint exists.

**`application.team_id` is `NOT NULL`.** An application always belongs to
exactly one opening and therefore one team. There is no cycle-wide application.

**Subteams stay explicit.** `team.parent_team_id` exists, and a grant on a
parent conveys nothing about a subteam — `authorization.md` section 5. Because
rules compile from `$in: teamIds`, that set is built from the caller's grants
and never walked up or down the tree. Inheritance would have to be written
deliberately into the set, where it would be visible, rather than emerging from
a join.

**A migration and a backfill.** The column is derived, so the backfill is
`UPDATE application SET team_id = o.team_id FROM recruitment_opening o WHERE
o.id = application.opening_id`, and the constraint is added after it. The
applicant surface already shipped, so this runs against existing rows.

**It does not help where the rule is not about a column.** Independent review is
still a cross-row rule — whether _this_ caller has submitted _their own_ review
of an application cannot be a column comparison on any table. That keeps its
existing technique: resolve `unblindedApplicationIds` per request and compile an
ordinary `$in`. See `authorization.md` section 4.
