# Running a Recruitment Cycle

The operational guide for ScottyLabs leadership. Everything here is
configuration: none of it requires a code change or a deploy.

## 1. Create the cycle

A **global** ScottyLabs admin (someone in the Keycloak admin group) creates the
cycle. That is deliberately the _only_ thing the global admin role grants here —
it confers no access to applicant data.

Open **Recruitment** and use **Start a cycle**: a slug and a name. You land on
the new cycle's **Settings**, because a cycle with no committee and nobody
enrolled cannot do anything yet.

Then grant yourself a recruitment admin membership under **Who may review**.
Doing this explicitly, and recording it in the audit log, is the point: nobody
reads applications by accident of holding an infrastructure role.

The underlying API, if you would rather script it:

```http
POST /recruitment/cycles
{ "slug": "fall-2026", "name": "Fall 2026", "minimumReviews": 3, "candidacyTopN": 3 }

POST /recruitment/cycles/{cycleId}/memberships
{ "userId": "your-andrew-id", "role": "recruitment_admin" }
```

## 2. Enrol reviewers

A person must have signed in at least once before they can be given a role —
otherwise the membership would point at an identity that never maps to a real
Andrew ID.

| Role                | Scope         | Can                                                                                                     |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `reviewer`          | one committee | See their queue, review, declare conflicts                                                              |
| `committee_lead`    | one committee | Everything a reviewer can, plus their committee's pool, aggregates, assignments, and proposed decisions |
| `recruitment_admin` | whole cycle   | Everything, including import, settings, reopening reviews, and final placement                          |

Grant and revoke under **Settings → Who may review**: an Andrew ID, a role, and
a committee. Granting the same role twice updates it rather than failing, and
re-granting a revoked one reactivates it.

A reviewer sees only the committees they were enrolled in. To assign someone
across committees, grant them a membership for each — assignment never silently
widens access.

Revoking deactivates rather than deletes, so reviews already submitted keep a
resolvable author.

## 3. Import the applications

Export the Google Form as `.xlsx` or `.csv` and upload it on **Import**, or
connect the sheet directly under **Settings → Application source** and press
**Sync now**. Both paths produce the same preview and the same commit step —
nothing is written until you confirm.

1. **Upload** — the file is parsed, every raw row stored, and a preview returned.
2. **Check the mapping.** Unrecognised and missing headers are reported rather
   than throwing. A renamed column shows up here; that is the only chance to
   catch it before it becomes a silently missing answer.
3. **Check the row errors.** A malformed row is isolated with the offending
   column named. One bad row never fails the batch.
4. **Commit.**

Re-uploading the same file is safe. Identity is _cycle plus normalised email_,
so a second import updates rather than duplicates, adds any missing candidacy,
and **never deletes a candidacy or touches a review**.

Two rows sharing an email inside one file are deduplicated too; the later row
wins.

### Candidacies

By default each applicant gets a candidacy for their **top three** committees,
plus any committee whose specific questions they chose to answer. Both are
per-cycle settings (`candidacyTopN`, `candidacyIncludeOptIns`). Their ranking of
all seven committees is stored regardless of which candidacies exist.

Outreach has a top-level ranking column but no question block. That needs no
special handling — a committee with no questions simply contributes a ranking.

## 4. Assign reviewers

Default is three reviewers per candidacy. `GET /recruitment/cycles/{id}/workloads`
shows assigned, submitted, conflicted, and outstanding counts per reviewer so
you can rebalance from real numbers.

A reviewer who has already submitted cannot be unassigned — rebalancing must not
destroy work.

### Conflicts

A reviewer declares a conflict with one action and is never asked why. Requiring
a written reason would push them to disclose a personal relationship. The
assignment is marked `conflicted`, any draft is discarded, the applicant is not
penalised, and the action is audited. Assign a replacement.

## 5. Review

Reviewers score five human criteria from 1 to 5, choose a recommendation and a
confidence, and write a rationale. Drafts autosave. Submission is explicit and
locks the review; only a recruitment admin can reopen it.

**A reviewer cannot see another reviewer's review of a candidacy until they have
submitted their own.** This is enforced in SQL, not by hiding elements. Touching
a peer's assignment returns 404, not 403 — a 403 would itself disclose that
someone else is assigned.

## 6. How the score is computed

For one reviewer on one candidacy:

```text
normalized(criterion) = (score - min) / (max - min)
points(criterion)     = normalized * weight * 100
review score          = sum of points, to 2 decimals
```

The default rubric:

| Criterion                       | Weight | Entered by                                   |
| ------------------------------- | -----: | -------------------------------------------- |
| Interest & Passion              |    30% | reviewer                                     |
| Initiative / Evidence of Action |    20% | reviewer                                     |
| Ideas & Potential Contributions |    20% | reviewer                                     |
| Relevant Experience / Readiness |    15% | reviewer                                     |
| Growth Potential                |    10% | reviewer                                     |
| Applicant Committee Preference  |     5% | **derived from the applicant's own ranking** |

The preference component is a lookup from the rank the applicant submitted
through the cycle's `preferenceScoreMap` (1st choice → 5, down to 7th → 1 by
default). It is never inferred from anything they wrote. A reviewer cannot enter
it; attempting to returns 422.

All fives with a first-choice preference is exactly 100; all ones is exactly 0.

Rubric weights must sum to 1. A rubric that does not is refused rather than
quietly rescaled, because rescaling would distort every score derived from it.

Editing a rubric publishes a **new version**. A submitted review keeps the
version it was scored under, so changing policy never rewrites history.

## 7. Aggregates and disagreement

Only submitted reviews count. For each candidacy: count, mean, median, min, max,
spread, population standard deviation, recommendation and confidence
distributions, and per-criterion averages.

A candidacy is flagged for another review when **any** rule matches:

- spread **≥** the threshold (default 20 points — at the threshold counts)
- recommendations span a positive and a negative extreme, where at least one is
  a "strong": `strong_yes`+`no`, `strong_yes`+`strong_no`, `yes`+`strong_no`.
  Plain `yes`+`no` deliberately does **not** flag — reasonable people differ.
- a committee lead asks for one

Every flag carries its reason as a readable sentence. The interface never shows
a bare flag.

## 8. Ranking

Ordered by mean score descending (unreviewed last), then by number of submitted
reviews, then by the applicant's own preference, then by name. Ties share a rank
and the next rank skips. Ordering never depends on input order.

Leadership can mark candidates for discussion and move them, but manual changes
never rewrite raw reviewer scores.

## 9. Decisions and placement

A committee proposes: `accept`, `waitlist`, `reject`, `discuss`, or `redirect`
(which must name the suggested committee). Capacity is shown, and exceeding it
warns rather than blocks.

**A proposal never becomes a placement.** An applicant wanted by two committees
appears in the placement queue with every interested committee listed in _their
own_ preference order, and a human chooses. There is no code path that derives a
placement from a numeric cutoff.

One final placement per applicant per cycle; changing it replaces rather than
duplicates.

## 10. Archiving

Set the cycle status to `archived`. Imports, decisions, and placements are then
refused, and the cycle stays readable. Settings changes never retroactively
mutate submitted review history.

## What the platform will never do

Summarised from [`product-rules.md`](product-rules.md), because it is the reason
several of the choices above look the way they do:

- No LLM or ML model evaluates an applicant. No score is generated from essay
  text; no trait is inferred from what anyone wrote.
- No applicant-provided link is ever fetched. GitHub, LinkedIn, and portfolio
  URLs render as inert external links, validated by shape only.
- No automatic accept or reject, including by numeric cutoff.
- The friend-placement answer is displayed for context and excluded from every
  scoring path.

Every subjective number in this system was typed by a named human.
