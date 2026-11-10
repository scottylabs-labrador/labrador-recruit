import { CONTENT_ONLY_TYPES } from "./types.ts";
import type { QuestionDefinition, QuestionType, VisibilityRule } from "./types.ts";

export interface FormProblem {
  questionKey: string;
  message: string;
}

export interface FormRulesResult {
  ok: boolean;
  /** Every problem, not just the first. */
  problems: FormProblem[];
}

const CHOICE_TYPES: readonly QuestionType[] = ["single_select", "multi_select", "dropdown"];

/**
 * Whether a form's questions can be published.
 *
 * This is the last point at which a broken rule can be fixed by the person who
 * wrote it. The evaluator deliberately **fails closed**, so a forward reference
 * at runtime means the question silently never appears — which looks like it
 * works right up until a cycle is open and an applicant is confused. Catching
 * it here is the difference between an error message and a defect nobody
 * notices for a month.
 *
 * Every problem is reported. A director with forty questions and one message
 * per attempt will republish forty times.
 */
export function validateFormRules(questions: readonly QuestionDefinition[]): FormRulesResult {
  const problems: FormProblem[] = [];
  const ordered = [...questions].sort((a, b) => a.position - b.position);

  const byKey = new Map<string, QuestionDefinition>();
  const seenKeys = new Set<string>();
  const seenPositions = new Map<number, string>();

  for (const question of ordered) {
    if (seenKeys.has(question.questionKey)) {
      problems.push({
        questionKey: question.questionKey,
        message: `The key "${question.questionKey}" is used more than once.`,
      });
    }
    seenKeys.add(question.questionKey);
    byKey.set(question.questionKey, question);

    const clash = seenPositions.get(question.position);
    if (clash !== undefined) {
      problems.push({
        questionKey: question.questionKey,
        message: `This question and "${clash}" are at the same position (${question.position}).`,
      });
    }
    seenPositions.set(question.position, question.questionKey);

    if (CHOICE_TYPES.includes(question.type)) {
      const choices = question.config?.choices ?? [];
      if (choices.length === 0) {
        problems.push({
          questionKey: question.questionKey,
          message: "A choice question needs at least one choice.",
        });
      }
    }
  }

  // Rules are checked against what came *earlier*, which is exactly the
  // information the evaluator has when it reaches the question.
  const earlier = new Set<string>();
  for (const question of ordered) {
    if (question.visibilityRule !== null) {
      problems.push(
        ...checkRule(question, question.visibilityRule, earlier, byKey).map((message) => ({
          questionKey: question.questionKey,
          message,
        })),
      );
    }
    earlier.add(question.questionKey);
  }

  return { ok: problems.length === 0, problems };
}

function checkRule(
  question: QuestionDefinition,
  rule: VisibilityRule,
  earlier: Set<string>,
  byKey: Map<string, QuestionDefinition>,
): string[] {
  if ("all" in rule) {
    return Array.isArray(rule.all)
      ? rule.all.flatMap((inner) => checkRule(question, inner, earlier, byKey))
      : ["That is not a supported rule."];
  }
  if ("any" in rule) {
    return Array.isArray(rule.any)
      ? rule.any.flatMap((inner) => checkRule(question, inner, earlier, byKey))
      : ["That is not a supported rule."];
  }
  if ("not" in rule) {
    return checkRule(question, rule.not, earlier, byKey);
  }

  const operator = (
    ["answered", "equals", "notEquals", "includes", "greaterThan", "lessThan"] as const
  ).find((name) => name in rule);

  if (operator === undefined) {
    return ["That is not a supported rule."];
  }

  const operand = (rule as Record<string, { questionKey: string; value?: unknown }>)[operator]!;
  const { questionKey } = operand;

  if (questionKey === question.questionKey) {
    return ["A question cannot depend on itself."];
  }
  if (!byKey.has(questionKey)) {
    return [`This rule refers to "${questionKey}", which is not a question on this form.`];
  }
  if (!earlier.has(questionKey)) {
    return [
      `This rule refers to "${questionKey}", which comes later in the form. A rule can only depend on an earlier question.`,
    ];
  }

  const target = byKey.get(questionKey)!;

  if (CONTENT_ONLY_TYPES.includes(target.type)) {
    return [`"${questionKey}" is a heading, so it has no answer to depend on.`];
  }

  if (operator === "greaterThan" || operator === "lessThan") {
    if (target.type !== "number") {
      // The evaluator refuses to coerce, by design, so this rule could never be
      // satisfied — the question would simply never appear.
      return [`"${questionKey}" does not hold a number, so it cannot be compared with one.`];
    }
  }

  if (operator === "includes" && target.type !== "multi_select") {
    return [`"${questionKey}" does not allow multiple answers, so nothing can be included in it.`];
  }

  if (operator === "equals" || operator === "notEquals") {
    const choices = target.config?.choices;
    const value = operand.value;
    if (
      CHOICE_TYPES.includes(target.type) &&
      choices !== undefined &&
      choices.length > 0 &&
      typeof value === "string" &&
      !choices.includes(value)
    ) {
      // The mistake a director makes by renaming a choice after writing a rule.
      // Nobody can ever select the old value, so the question can never appear.
      return [`"${value}" is not one of the choices for "${questionKey}".`];
    }
  }

  return [];
}
