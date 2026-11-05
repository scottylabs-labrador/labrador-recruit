/**
 * Publish-time validation of a form's questions.
 *
 * This is the check that makes the evaluator's single pass safe. The evaluator
 * fails closed on a forward reference, which means the question silently never
 * appears — so the only place to catch it where somebody can still fix it is
 * here, before the version is frozen.
 */
import { describe, expect, it } from "vitest";

import { validateFormRules } from "../src/forms/formRules.ts";
import type { QuestionDefinition, QuestionType } from "../src/forms/types.ts";

function q(
  questionKey: string,
  position: number,
  overrides: Partial<QuestionDefinition> = {},
): QuestionDefinition {
  return {
    questionKey,
    type: "short_text" as QuestionType,
    label: questionKey,
    required: false,
    position,
    config: null,
    visibilityRule: null,
    ...overrides,
  };
}

describe("validateFormRules", () => {
  it("accepts a form with no rules", () => {
    const result = validateFormRules([q("a", 1), q("b", 2)]);

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("accepts a rule referencing an earlier question", () => {
    const result = validateFormRules([
      q("area", 1),
      q("ai", 2, { visibilityRule: { equals: { questionKey: "area", value: "AI" } } }),
    ]);

    expect(result.ok).toBe(true);
  });

  it("rejects a rule referencing a later question", () => {
    const result = validateFormRules([
      q("early", 1, { visibilityRule: { equals: { questionKey: "late", value: "x" } } }),
      q("late", 2),
    ]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.questionKey).toBe("early");
    expect(result.problems[0]!.message).toMatch(/later/i);
    // The message has to name the offending key, or a director with forty
    // questions cannot act on it.
    expect(result.problems[0]!.message).toContain("late");
  });

  it("rejects a rule referencing itself", () => {
    const result = validateFormRules([
      q("loop", 1, { visibilityRule: { answered: { questionKey: "loop" } } }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toMatch(/itself/i);
  });

  it("rejects a rule referencing a question that does not exist", () => {
    const result = validateFormRules([
      q("orphan", 1, { visibilityRule: { equals: { questionKey: "gone", value: "x" } } }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toContain("gone");
  });

  it("checks every reference inside a combinator, not just the first", () => {
    const result = validateFormRules([
      q("area", 1),
      q("both", 2, {
        visibilityRule: {
          all: [
            { equals: { questionKey: "area", value: "AI" } },
            { equals: { questionKey: "missing", value: "x" } },
          ],
        },
      }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toContain("missing");
  });

  it("checks references inside a nested not", () => {
    const result = validateFormRules([
      q("a", 1, { visibilityRule: { not: { equals: { questionKey: "nope", value: "x" } } } }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toContain("nope");
  });

  it("rejects a malformed rule", () => {
    const result = validateFormRules([q("broken", 1, { visibilityRule: { oops: 1 } as never })]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toMatch(/not a supported/i);
  });

  it("rejects a numeric comparison against a question that cannot hold a number", () => {
    const result = validateFormRules([
      q("name", 1, { type: "short_text" }),
      q("after", 2, { visibilityRule: { lessThan: { questionKey: "name", value: 5 } } }),
    ]);

    // The evaluator refuses to coerce, so this rule can never be satisfied. A
    // question that can never appear is worse than an error: it looks like it
    // works right up until a cycle is open.
    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toMatch(/number/i);
  });

  it("rejects an includes rule against a question that is not multi-select", () => {
    const result = validateFormRules([
      q("name", 1, { type: "short_text" }),
      q("after", 2, { visibilityRule: { includes: { questionKey: "name", value: "x" } } }),
    ]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toMatch(/multiple/i);
  });

  it("rejects a rule depending on a content-only question", () => {
    const result = validateFormRules([
      q("heading", 1, { type: "section_heading" }),
      q("after", 2, { visibilityRule: { answered: { questionKey: "heading" } } }),
    ]);

    // A heading carries no answer, so the rule can never be satisfied.
    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toMatch(/no answer/i);
  });

  it("rejects a duplicate question key", () => {
    const result = validateFormRules([q("same", 1), q("same", 2)]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toMatch(/more than once/i);
  });

  it("rejects a duplicate position", () => {
    const result = validateFormRules([q("a", 1), q("b", 1)]);

    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toMatch(/same position/i);
  });

  it("rejects a choice question with no choices", () => {
    const result = validateFormRules([q("area", 1, { type: "single_select", config: {} })]);

    // Publishing this gives applicants a question with nothing to pick.
    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toMatch(/at least one choice/i);
  });

  it("rejects an equality rule whose value is not among the question's choices", () => {
    const result = validateFormRules([
      q("area", 1, { type: "single_select", config: { choices: ["AI", "Design"] } }),
      q("after", 2, { visibilityRule: { equals: { questionKey: "area", value: "Finance" } } }),
    ]);

    // Nobody can ever select "Finance", so the question can never appear. This
    // is the mistake a director makes by renaming a choice after writing a rule.
    expect(result.ok).toBe(false);
    expect(result.problems[0]!.message).toContain("Finance");
  });

  it("reports every problem, not just the first", () => {
    const result = validateFormRules([
      q("a", 1, { visibilityRule: { equals: { questionKey: "nope", value: "x" } } }),
      q("b", 2, { type: "single_select", config: {} }),
    ]);

    expect(result.problems).toHaveLength(2);
  });
});
