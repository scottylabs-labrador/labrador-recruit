# 5. A small closed vocabulary for conditional visibility rules

Date: 2026-11-04

## Status

Accepted

## Context

A committee director must be able to make a question appear based on an earlier
answer — "you said AI, so describe an AI project" — without a code change.
`docs/design.md` section 13 left the rule format to the builder, with three
constraints: it is structured data rather than executable code, it is evaluated
by exactly one shared function, and it round-trips through the builder UI.

The space of options runs from a single `equals` to a general expression
language. The builder UI (#25) has to render whatever we pick as a form, and the
renderer (#22) and the submission validator (#20) both have to agree about it
exactly.

## Decision

A small, closed, discriminated union:

```ts
type VisibilityRule =
  | { equals: { questionKey: string; value: AnswerValue } }
  | { notEquals: { questionKey: string; value: AnswerValue } }
  | { includes: { questionKey: string; value: string } }
  | { answered: { questionKey: string } }
  | { greaterThan: { questionKey: string; value: number } }
  | { lessThan: { questionKey: string; value: number } }
  | { all: VisibilityRule[] }
  | { any: VisibilityRule[] }
  | { not: VisibilityRule };
```

Stored in `question.visibility_rule_json`. Evaluated only by
`evaluateVisibility` in `packages/common/src/forms/visibility.ts`.

Four properties the evaluator guarantees, each with tests:

1. **One pass, in `position` order.** A rule may only reference keys earlier in
   the form. Publishing refuses a forward reference (#17); the evaluator fails
   closed if one arrives anyway.
2. **Fails closed everywhere.** An absent answer, a malformed rule, a reference
   to a key that does not exist, or a reference to a question that is _itself_
   hidden all mean "not visible".
3. **A hidden question's answer is unreadable.** A rule depending on a hidden
   question cannot hold, however stale an answer that question still carries. So
   changing an earlier answer collapses the whole chain below it rather than
   leaving a question on screen for reasons nobody can explain.
4. **No coercion.** `"2027"` does not satisfy `lessThan: 2028`.

## Consequences

Good:

- **The builder can render it.** Nine operators map onto a select plus a value
  field. A general expression language would have needed an editor nobody could
  build in a sprint, or a text box that lets a director write a form that cannot
  be reasoned about.
- **No sandbox.** A rule stored as code would have to run somewhere, and that
  somewhere would be a sandbox we then own — on a system holding other students'
  application essays. This closes that off by construction rather than by
  policy.
- **The evaluator is 150 lines and exhaustively testable.** 17 tests cover every
  operator, both combinators, negation of a malformed rule, chains, forward
  references, and absent-versus-empty answers. That matters because this one
  function decides what was required of an applicant.
- **Fail-closed is the safe direction here.** The worst outcome is not a
  question that fails to appear — it is the validator demanding an answer the
  applicant was never shown, which blocks a submission with nothing on screen to
  explain it.

Bad, and accepted:

- **No arithmetic, no string matching, no cross-form references.** A director
  who wants "show this if the essay is over 500 characters" cannot have it. If
  that turns out to be needed, it is one more operator and a migration of
  nothing — the union is additive.
- **No forward references, ever.** Reordering questions can therefore invalidate
  a rule, and the publish check is what catches it. The alternative is a fixpoint
  loop, which would let a form's visibility depend on itself.
- **`notEquals` requires an answer**, so it is not the strict logical negation
  of `equals`. "Not equal to X" is not satisfied by having said nothing —
  otherwise every such question would appear on a blank form. This is the one
  operator whose behaviour will surprise somebody, so it is tested explicitly.
- **`not` requires its inner rule to be well formed** before trusting the
  negation. A malformed rule is unsatisfied, so `not` of it would otherwise be
  satisfied, and a broken rule would _show_ a question rather than hide it.

Rejected: a JSONLogic-style generic evaluator. It solves a problem we do not
have, brings an operator set we would have to audit for the sandbox question
anyway, and makes the builder UI the hard part of the feature.
