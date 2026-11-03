# 3. Carry over the no-AI-evaluation product rules, and add committee isolation

Date: 2026-11-03

## Status

Accepted

## Context

The previous version carries `docs/product-rules.md`: seven rules constraining
what the platform may do, the first of which forbids using an LLM or any ML model
to judge, analyse, summarise, classify, rank, or score an applicant. It has one
narrow carve-out, decided by ScottyLabs recruitment leadership on 4 September
2026, permitting the display of verbatim facts GitHub itself states for an
applicant who supplied a GitHub link.

The ScottyLabs Recruit proposal does not mention any of this. It is silent rather
than contradictory — but section 8.3 does say "the system can compute a summary
or average score", which is precisely the sentence somebody will later read as
permission to add a model.

## Decision

Carry the rules over unchanged in substance, keep the GitHub carve-out, and keep
the rule as the thing that overrides everything in `AGENTS.md` and `CLAUDE.md`.

Add **section 8, committee isolation**: a committee sees its own applicants and
nobody else's, enforced in SQL, with invisible resources returning 404 rather
than 403. The previous version had one committee, so this rule had nothing to
constrain. It is now the second rule whose violation would be unrecoverable.

Small terminology updates only: "candidacy" becomes "application", since the
multi-committee model collapses that table; and sections 5 and 7 gain the form
version and rubric locking mechanisms that make cycle isolation concrete.

We rejected dropping the GitHub carve-out. It was a leadership decision with
recorded reasoning, it is already implemented behind a flag, and removing a
permission we were explicitly granted is not ours to do unilaterally.

We rejected leaving the rules out pending review by recruitment leadership. They
are settled ScottyLabs policy, not an artifact of one implementation, and the
cost of carrying them is zero because the architecture already enforces them: all
scoring arithmetic lives in `packages/common` as pure functions with no database
or network access.

## Consequences

Good:

- The constraint is architectural rather than aspirational. A pure-function
  scoring layer with no network access cannot call a model, so the rule is
  enforced by the dependency graph and not by reviewer vigilance.
- `product-rules.md` section 2 — every aggregate reproducible by hand, with the
  interface able to show which reviews contributed — gives reviewers and
  applicants a defensible answer about how a number was produced.
- Agents working in this repository get the rule in the first screen of
  `CLAUDE.md`, where it binds the contributor most likely to offer to summarize
  an essay.

Bad:

- Features that would be genuinely convenient are off the table: no
  auto-summarizing long answers for a reviewer in a hurry, no flagging likely
  strong candidates, no automatic shortlist by score. This will be asked for.
  The answer is no, and the reason is in section 1.
- The GitHub carve-out is a real exception that has to be defended as narrow
  every time somebody proposes widening it to LinkedIn or a portfolio site.
  Section 1 enumerates exactly which facts may be shown, which is what makes the
  boundary checkable.
- Committee isolation has a cost in query construction: every read of applicant
  data reaches its team through `recruitment_opening` and must be narrowed by a
  compiled predicate. That is more work per endpoint than a naive implementation,
  and it is the work.
