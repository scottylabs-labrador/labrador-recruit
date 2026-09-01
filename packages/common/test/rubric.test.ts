import { describe, expect, it } from "vitest";

import { validateRubric } from "../src/recruitment/rubric.ts";
import type { RubricValidationIssue, ScoringCriterion } from "../src/recruitment/types.ts";

function criterion(overrides: Partial<ScoringCriterion> & { key: string }): ScoringCriterion {
  return {
    weight: 0.5,
    minScore: 1,
    maxScore: 5,
    source: "reviewer",
    active: true,
    ...overrides,
  };
}

function codesOf(issues: RubricValidationIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

/** The rubric a new recruitment cycle is seeded with. */
function defaultRubric(): ScoringCriterion[] {
  return [
    criterion({ key: "technical", weight: 0.3 }),
    criterion({ key: "communication", weight: 0.2 }),
    criterion({ key: "collaboration", weight: 0.2 }),
    criterion({ key: "initiative", weight: 0.15 }),
    criterion({ key: "reliability", weight: 0.1 }),
    criterion({ key: "preference", weight: 0.05, source: "application_preference" }),
  ];
}

describe("validateRubric", () => {
  describe("valid rubrics", () => {
    it("accepts a two-criterion rubric whose weights sum to exactly 1", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 0.5 }),
        criterion({ key: "fit", weight: 0.5 }),
      ]);

      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it("accepts the real default rubric of 0.3 / 0.2 / 0.2 / 0.15 / 0.1 / 0.05", () => {
      const result = validateRubric(defaultRubric());

      expect(result.issues).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("accepts the same weights in an order that does drift off 1 in IEEE 754", () => {
      // Reordering a criterion list must not change whether the rubric is
      // valid, but in binary floating point it changes the sum: this order
      // adds up to 1.0000000000000002, which only the epsilon rescues.
      const driftingSum = 0.3 + 0.2 + 0.15 + 0.2 + 0.05 + 0.1;
      expect(driftingSum).not.toBe(1);

      const result = validateRubric([
        criterion({ key: "technical", weight: 0.3 }),
        criterion({ key: "communication", weight: 0.2 }),
        criterion({ key: "initiative", weight: 0.15 }),
        criterion({ key: "collaboration", weight: 0.2 }),
        criterion({ key: "preference", weight: 0.05, source: "application_preference" }),
        criterion({ key: "reliability", weight: 0.1 }),
      ]);

      expect(result.issues).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("accepts a single criterion carrying the whole weight", () => {
      const result = validateRubric([criterion({ key: "overall", weight: 1 })]);

      expect(result.valid).toBe(true);
    });

    it("accepts a zero-weight active criterion when the others still sum to 1", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 1 }),
        criterion({ key: "notes", weight: 0 }),
      ]);

      expect(result.valid).toBe(true);
    });

    it("excludes inactive criteria from the weight sum", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 0.6 }),
        criterion({ key: "fit", weight: 0.4 }),
        criterion({ key: "retired", weight: 0.9, active: false }),
      ]);

      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });
  });

  describe("weights that do not sum to one", () => {
    it("rejects a sum of 0.99", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 0.5 }),
        criterion({ key: "fit", weight: 0.49 }),
      ]);

      expect(result.valid).toBe(false);
      expect(codesOf(result.issues)).toEqual(["weights_do_not_sum_to_one"]);
    });

    it("rejects a sum of 1.01", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 0.5 }),
        criterion({ key: "fit", weight: 0.51 }),
      ]);

      expect(result.valid).toBe(false);
      expect(codesOf(result.issues)).toEqual(["weights_do_not_sum_to_one"]);
    });

    it("names the actual sum in the message so a lead can see the gap", () => {
      const result = validateRubric([criterion({ key: "technical", weight: 0.5 })]);
      const issue = result.issues[0];

      expect(issue?.code).toBe("weights_do_not_sum_to_one");
      expect(issue?.message).toContain("0.5");
    });

    it("rejects a rubric whose only active criterion is a fraction of 1", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 0.6 }),
        criterion({ key: "fit", weight: 0.4, active: false }),
      ]);

      expect(codesOf(result.issues)).toEqual(["weights_do_not_sum_to_one"]);
    });

    it("tolerates drift smaller than the epsilon", () => {
      const result = validateRubric([criterion({ key: "technical", weight: 1 + 1e-9 })]);

      expect(result.valid).toBe(true);
    });

    it("does not tolerate drift larger than the epsilon", () => {
      const result = validateRubric([criterion({ key: "technical", weight: 1 + 1e-4 })]);

      expect(codesOf(result.issues)).toEqual(["weights_do_not_sum_to_one"]);
    });
  });

  describe("negative weights", () => {
    it("reports a negative weight on an active criterion", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 1.2 }),
        criterion({ key: "penalty", weight: -0.2 }),
      ]);

      expect(result.valid).toBe(false);
      expect(codesOf(result.issues)).toContain("negative_weight");
      expect(result.issues.find((issue) => issue.code === "negative_weight")?.criterionKey).toBe(
        "penalty",
      );
    });

    it("reports a negative weight on an inactive criterion too", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 1 }),
        criterion({ key: "penalty", weight: -0.5, active: false }),
      ]);

      expect(codesOf(result.issues)).toEqual(["negative_weight"]);
    });

    it("reports one issue per offending criterion", () => {
      const result = validateRubric([
        criterion({ key: "a", weight: -0.1 }),
        criterion({ key: "b", weight: -0.2 }),
        criterion({ key: "c", weight: 1.3 }),
      ]);

      const negatives = result.issues.filter((issue) => issue.code === "negative_weight");
      expect(negatives).toHaveLength(2);
    });
  });

  describe("invalid bounds", () => {
    it("rejects a minimum above the maximum", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 1, minScore: 5, maxScore: 1 }),
      ]);

      expect(result.valid).toBe(false);
      expect(codesOf(result.issues)).toEqual(["invalid_bounds"]);
    });

    it("rejects a minimum equal to the maximum", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 1, minScore: 3, maxScore: 3 }),
      ]);

      expect(codesOf(result.issues)).toEqual(["invalid_bounds"]);
    });

    it("checks bounds on inactive criteria as well", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 1 }),
        criterion({ key: "retired", weight: 0, active: false, minScore: 9, maxScore: 2 }),
      ]);

      expect(codesOf(result.issues)).toEqual(["invalid_bounds"]);
      expect(result.issues[0]?.criterionKey).toBe("retired");
    });

    it("accepts bounds only one apart", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 1, minScore: 0, maxScore: 1 }),
      ]);

      expect(result.valid).toBe(true);
    });
  });

  describe("duplicate keys", () => {
    it("reports a repeated key once, not once per repeat", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 0.4 }),
        criterion({ key: "technical", weight: 0.3 }),
        criterion({ key: "technical", weight: 0.3 }),
      ]);

      const duplicates = result.issues.filter((issue) => issue.code === "duplicate_key");
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.criterionKey).toBe("technical");
    });

    it("reports duplicates that span the active/inactive boundary", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 1 }),
        criterion({ key: "technical", weight: 0, active: false }),
      ]);

      expect(codesOf(result.issues)).toEqual(["duplicate_key"]);
    });

    it("reports each distinct duplicated key separately", () => {
      const result = validateRubric([
        criterion({ key: "a", weight: 0.25 }),
        criterion({ key: "a", weight: 0.25 }),
        criterion({ key: "b", weight: 0.25 }),
        criterion({ key: "b", weight: 0.25 }),
      ]);

      const duplicates = result.issues.filter((issue) => issue.code === "duplicate_key");
      expect(duplicates.map((issue) => issue.criterionKey)).toEqual(["a", "b"]);
    });
  });

  describe("no active criteria", () => {
    it("reports an empty rubric", () => {
      const result = validateRubric([]);

      expect(result.valid).toBe(false);
      expect(codesOf(result.issues)).toEqual(["no_active_criteria"]);
    });

    it("reports a rubric where every criterion is inactive", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: 0.5, active: false }),
        criterion({ key: "fit", weight: 0.5, active: false }),
      ]);

      expect(codesOf(result.issues)).toEqual(["no_active_criteria"]);
    });

    it("does not also complain about the weight sum, which would be noise", () => {
      const result = validateRubric([criterion({ key: "technical", weight: 1, active: false })]);

      expect(codesOf(result.issues)).not.toContain("weights_do_not_sum_to_one");
    });
  });

  describe("multiple simultaneous issues", () => {
    it("reports every problem in one pass rather than stopping at the first", () => {
      const result = validateRubric([
        criterion({ key: "technical", weight: -0.3 }),
        criterion({ key: "technical", weight: 0.4 }),
        criterion({ key: "fit", weight: 0.4, minScore: 5, maxScore: 5 }),
      ]);

      expect(result.valid).toBe(false);
      expect(codesOf(result.issues).sort()).toEqual([
        "duplicate_key",
        "invalid_bounds",
        "negative_weight",
        "weights_do_not_sum_to_one",
      ]);
    });

    it("never throws, however broken the rubric", () => {
      expect(() =>
        validateRubric([
          criterion({ key: "x", weight: -1, minScore: 10, maxScore: 0, active: false }),
          criterion({ key: "x", weight: Number.NaN }),
        ]),
      ).not.toThrow();
    });

    it("gives every issue a non-empty human-readable message", () => {
      const result = validateRubric([
        criterion({ key: "dup", weight: -1 }),
        criterion({ key: "dup", weight: 0.5, minScore: 4, maxScore: 2 }),
      ]);

      for (const issue of result.issues) {
        expect(issue.message.length).toBeGreaterThan(0);
        expect(issue.message.endsWith(".")).toBe(true);
      }
    });
  });
});
