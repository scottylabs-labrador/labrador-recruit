import type { AnswerMap, AnswerValue, QuestionDefinition, VisibilityRule } from "./types.ts";

/**
 * Which questions are visible, given the answers so far.
 *
 * **One implementation, two callers.** The browser renderer uses it to decide
 * what to show; the server submission validator uses it to decide what was
 * required. Two implementations would disagree eventually, the disagreement
 * would be silent, and it would favour whoever was probing the form.
 *
 * A single pass in `position` order. That is why a rule may only reference keys
 * earlier in the form — a forward reference cannot be resolved without a second
 * pass, and a fixpoint loop would let a director write a form whose visibility
 * depends on itself. Publishing refuses forward references; this fails closed if
 * one arrives anyway.
 *
 * **Fails closed throughout.** An absent answer, a malformed rule, a reference
 * to a key that does not exist, or a reference to a question that is itself
 * hidden all mean "not visible". The alternative is a question appearing on a
 * form for reasons nobody can explain, and — worse, in the validator — an
 * answer being demanded that the applicant was never shown.
 */
export function evaluateVisibility(
  questions: readonly QuestionDefinition[],
  answers: AnswerMap,
): Set<string> {
  const visible = new Set<string>();
  const ordered = [...questions].sort((a, b) => a.position - b.position);

  for (const question of ordered) {
    if (question.visibilityRule === null) {
      visible.add(question.questionKey);
      continue;
    }
    if (isSatisfied(question.visibilityRule, answers, visible)) {
      visible.add(question.questionKey);
    }
  }

  return visible;
}

/**
 * Whether a rule holds.
 *
 * `visibleSoFar` is what makes a chain honest: a rule referencing a question
 * that is hidden cannot hold, however stale an answer that question still
 * carries. Without it, changing an earlier answer would leave a third question
 * on screen because the second one's abandoned answer still matched.
 */
function isSatisfied(rule: VisibilityRule, answers: AnswerMap, visibleSoFar: Set<string>): boolean {
  if ("all" in rule) {
    return Array.isArray(rule.all) && rule.all.every((r) => isSatisfied(r, answers, visibleSoFar));
  }
  if ("any" in rule) {
    return Array.isArray(rule.any) && rule.any.some((r) => isSatisfied(r, answers, visibleSoFar));
  }
  if ("not" in rule) {
    // A malformed inner rule is unsatisfied, so `not` of it would be satisfied —
    // which would show the question. Require the inner rule to be well formed
    // before trusting its negation.
    return isWellFormed(rule.not) && !isSatisfied(rule.not, answers, visibleSoFar);
  }

  if ("answered" in rule) {
    const { questionKey } = rule.answered;
    return readable(questionKey, visibleSoFar) && isAnswered(answers[questionKey]);
  }
  if ("equals" in rule) {
    const { questionKey, value } = rule.equals;
    return readable(questionKey, visibleSoFar) && same(answers[questionKey], value);
  }
  if ("notEquals" in rule) {
    const { questionKey, value } = rule.notEquals;
    // Requires an answer: "not equal to X" is not satisfied by having said
    // nothing. Otherwise every such question would show on a blank form.
    return (
      readable(questionKey, visibleSoFar) &&
      isAnswered(answers[questionKey]) &&
      !same(answers[questionKey], value)
    );
  }
  if ("includes" in rule) {
    const { questionKey, value } = rule.includes;
    if (!readable(questionKey, visibleSoFar)) {
      return false;
    }
    const answer = answers[questionKey];
    return Array.isArray(answer) && answer.includes(value);
  }
  if ("greaterThan" in rule) {
    const { questionKey, value } = rule.greaterThan;
    const answer = readable(questionKey, visibleSoFar) ? answers[questionKey] : null;
    return typeof answer === "number" && answer > value;
  }
  if ("lessThan" in rule) {
    const { questionKey, value } = rule.lessThan;
    const answer = readable(questionKey, visibleSoFar) ? answers[questionKey] : null;
    return typeof answer === "number" && answer < value;
  }

  // Not a shape the format allows, so it can only have arrived from hand-edited
  // data. Fail closed.
  return false;
}

/**
 * Whether a rule is one of the shapes the format allows.
 *
 * Only `not` needs this, because it is the one operator where "unsatisfied"
 * and "malformed" would produce opposite outcomes.
 */
function isWellFormed(rule: VisibilityRule): boolean {
  return (
    typeof rule === "object" &&
    rule !== null &&
    [
      "all",
      "any",
      "not",
      "answered",
      "equals",
      "notEquals",
      "includes",
      "greaterThan",
      "lessThan",
    ].some((key) => key in rule)
  );
}

/**
 * Whether a rule may read this question's answer.
 *
 * It must be visible — a hidden question's answer is stale by definition — and
 * `visibleSoFar` only contains questions already evaluated, so a forward
 * reference is unreadable and the rule fails closed. A key that names no
 * question at all is unreadable for the same reason.
 */
function readable(questionKey: string, visibleSoFar: Set<string>): boolean {
  return visibleSoFar.has(questionKey);
}

/**
 * Whether there is an answer at all.
 *
 * An empty string and an empty selection count as unanswered. Somebody who
 * cleared a field has not answered it, and treating `""` as an answer would keep
 * a conditional question on screen after the thing that summoned it was removed.
 */
function isAnswered(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim() !== "";
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

/**
 * Equality, without coercion.
 *
 * `"2027"` does not equal `2027` here. A numeric comparison against text is a
 * question configured wrongly, not a reason to guess — and a guess is exactly
 * the kind of thing the renderer and the validator could come to make
 * differently.
 */
function same(answer: AnswerValue | undefined, value: AnswerValue): boolean {
  if (Array.isArray(answer) || Array.isArray(value)) {
    return (
      Array.isArray(answer) &&
      Array.isArray(value) &&
      answer.length === value.length &&
      answer.every((entry, index) => entry === value[index])
    );
  }
  return answer === value;
}
