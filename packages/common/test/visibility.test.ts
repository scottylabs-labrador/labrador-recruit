/**
 * The conditional visibility evaluator.
 *
 * One implementation, used by the browser renderer to decide what to show and
 * by the server submission validator to decide what was required. If those were
 * two implementations they would disagree, the disagreement would be silent,
 * and it would favour whoever was probing.
 */
import { describe, expect, it } from "vitest";

import type { QuestionDefinition } from "../src/forms/types.ts";
import { evaluateVisibility } from "../src/forms/visibility.ts";

function q(
  questionKey: string,
  position: number,
  visibilityRule: QuestionDefinition["visibilityRule"] = null,
): QuestionDefinition {
  return {
    questionKey,
    type: "short_text",
    label: questionKey,
    required: false,
    position,
    config: null,
    visibilityRule,
  };
}

describe("evaluateVisibility", () => {
  it("shows a question with no rule", () => {
    const visible = evaluateVisibility([q("major", 1)], {});

    expect(visible.has("major")).toBe(true);
  });

  it("shows a question whose equality rule is satisfied", () => {
    const questions = [
      q("area", 1),
      q("ai-project", 2, { equals: { questionKey: "area", value: "AI" } }),
    ];

    const visible = evaluateVisibility(questions, { area: "AI" });

    expect(visible.has("ai-project")).toBe(true);
  });

  it("hides a question whose equality rule is not satisfied", () => {
    const questions = [
      q("area", 1),
      q("ai-project", 2, { equals: { questionKey: "area", value: "AI" } }),
    ];

    const visible = evaluateVisibility(questions, { area: "Design" });

    expect(visible.has("ai-project")).toBe(false);
  });

  it("hides a conditional question when the answer it depends on is absent", () => {
    const questions = [
      q("area", 1),
      q("ai-project", 2, { equals: { questionKey: "area", value: "AI" } }),
    ];

    // An unanswered question has not satisfied anything. Treating absent as a
    // match would show every conditional question on a blank form.
    const visible = evaluateVisibility(questions, {});

    expect(visible.has("ai-project")).toBe(false);
  });

  it("distinguishes an absent answer from an empty one", () => {
    const questions = [q("area", 1), q("follow-up", 2, { answered: { questionKey: "area" } })];

    expect(evaluateVisibility(questions, {}).has("follow-up")).toBe(false);
    expect(evaluateVisibility(questions, { area: "" }).has("follow-up")).toBe(false);
    expect(evaluateVisibility(questions, { area: "AI" }).has("follow-up")).toBe(true);
  });

  it("treats an empty multi-select as unanswered", () => {
    const questions = [q("langs", 1), q("follow-up", 2, { answered: { questionKey: "langs" } })];

    expect(evaluateVisibility(questions, { langs: [] }).has("follow-up")).toBe(false);
    expect(evaluateVisibility(questions, { langs: ["Rust"] }).has("follow-up")).toBe(true);
  });

  it("matches membership of a multi-select answer", () => {
    const questions = [
      q("langs", 1),
      q("rust-detail", 2, { includes: { questionKey: "langs", value: "Rust" } }),
    ];

    expect(evaluateVisibility(questions, { langs: ["Go", "Rust"] }).has("rust-detail")).toBe(true);
    expect(evaluateVisibility(questions, { langs: ["Go"] }).has("rust-detail")).toBe(false);
  });

  it("compares numbers", () => {
    const questions = [
      q("year", 1),
      q("senior-only", 2, { lessThan: { questionKey: "year", value: 2028 } }),
    ];

    expect(evaluateVisibility(questions, { year: 2027 }).has("senior-only")).toBe(true);
    expect(evaluateVisibility(questions, { year: 2029 }).has("senior-only")).toBe(false);
  });

  it("does not coerce a string into a number for a comparison", () => {
    const questions = [
      q("year", 1),
      q("senior-only", 2, { lessThan: { questionKey: "year", value: 2028 } }),
    ];

    // A numeric comparison against text is a question configured wrongly, not a
    // reason to guess. Guessing here would mean the renderer and the validator
    // could guess differently.
    expect(evaluateVisibility(questions, { year: "2027" }).has("senior-only")).toBe(false);
  });

  it("combines rules with all", () => {
    const questions = [
      q("area", 1),
      q("year", 2),
      q("both", 3, {
        all: [
          { equals: { questionKey: "area", value: "AI" } },
          { lessThan: { questionKey: "year", value: 2028 } },
        ],
      }),
    ];

    expect(evaluateVisibility(questions, { area: "AI", year: 2027 }).has("both")).toBe(true);
    expect(evaluateVisibility(questions, { area: "AI", year: 2029 }).has("both")).toBe(false);
  });

  it("combines rules with any", () => {
    const questions = [
      q("area", 1),
      q("year", 2),
      q("either", 3, {
        any: [
          { equals: { questionKey: "area", value: "AI" } },
          { lessThan: { questionKey: "year", value: 2028 } },
        ],
      }),
    ];

    expect(evaluateVisibility(questions, { area: "Design", year: 2027 }).has("either")).toBe(true);
    expect(evaluateVisibility(questions, { area: "Design", year: 2029 }).has("either")).toBe(false);
  });

  it("negates with not", () => {
    const questions = [
      q("area", 1),
      q("not-ai", 2, { not: { equals: { questionKey: "area", value: "AI" } } }),
    ];

    expect(evaluateVisibility(questions, { area: "Design" }).has("not-ai")).toBe(true);
    expect(evaluateVisibility(questions, { area: "AI" }).has("not-ai")).toBe(false);
  });

  it("hides a question whose visible dependency is itself hidden", () => {
    const questions = [
      q("area", 1),
      q("ai-project", 2, { equals: { questionKey: "area", value: "AI" } }),
      q("ai-detail", 3, { answered: { questionKey: "ai-project" } }),
    ];

    // `ai-project` is hidden, so its stale answer must not keep a third question
    // alive. A chain is only as visible as its weakest link.
    const visible = evaluateVisibility(questions, { area: "Design", "ai-project": "leftover" });

    expect(visible.has("ai-project")).toBe(false);
    expect(visible.has("ai-detail")).toBe(false);
  });

  it("evaluates in position order regardless of array order", () => {
    const questions = [
      q("ai-project", 2, { equals: { questionKey: "area", value: "AI" } }),
      q("area", 1),
    ];

    // The single pass is over position, not over however the rows arrived.
    const visible = evaluateVisibility(questions, { area: "AI" });

    expect(visible.has("ai-project")).toBe(true);
  });

  it("hides a question whose rule names a key that does not exist", () => {
    const questions = [q("orphan", 1, { equals: { questionKey: "gone", value: "x" } })];

    // Publishing refuses this, so reaching it means a form was edited around
    // that check. Failing closed keeps a question from appearing unexplained.
    const visible = evaluateVisibility(questions, {});

    expect(visible.has("orphan")).toBe(false);
  });

  it("hides a question whose rule is malformed", () => {
    const questions = [
      // Not a shape the format allows. It can only arrive from hand-edited data.
      q("broken", 1, { nonsense: true } as never),
    ];

    const visible = evaluateVisibility(questions, {});

    expect(visible.has("broken")).toBe(false);
  });

  it("never shows a question that depends on a later one", () => {
    const questions = [
      q("early", 1, { equals: { questionKey: "late", value: "x" } }),
      q("late", 2),
    ];

    // A forward reference cannot be resolved in one pass. Publishing refuses it;
    // the evaluator fails closed rather than reading a half-computed state.
    const visible = evaluateVisibility(questions, { late: "x" });

    expect(visible.has("early")).toBe(false);
  });
});
