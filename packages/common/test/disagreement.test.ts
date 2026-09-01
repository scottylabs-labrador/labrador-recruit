import { describe, expect, it } from "vitest";

import { detectDisagreement } from "../src/recruitment/disagreement.ts";
import type { DisagreementInput, RecommendationValue } from "../src/recruitment/types.ts";

function input(overrides: Partial<DisagreementInput>): DisagreementInput {
  return {
    scores: [],
    recommendations: [],
    spreadThreshold: 20,
    flagOnExtremeConflict: true,
    ...overrides,
  };
}

function recommendations(...values: RecommendationValue[]): RecommendationValue[] {
  return values;
}

describe("detectDisagreement", () => {
  describe("the spread threshold", () => {
    it("does not flag a spread of 19 against a threshold of 20", () => {
      const result = detectDisagreement(input({ scores: [61, 80] }));

      expect(result.flagged).toBe(false);
      expect(result.reasons).toEqual([]);
    });

    it("flags a spread of exactly 20, because the threshold is inclusive", () => {
      const result = detectDisagreement(input({ scores: [60, 80] }));

      expect(result.flagged).toBe(true);
      expect(result.reasons).toHaveLength(1);
    });

    it("flags a spread of 21", () => {
      expect(detectDisagreement(input({ scores: [59, 80] })).flagged).toBe(true);
    });

    it("names both the actual spread and the configured threshold", () => {
      const reason = detectDisagreement(input({ scores: [40, 85] })).reasons[0] ?? "";

      expect(reason).toContain("45");
      expect(reason).toContain("20");
      expect(reason.endsWith(".")).toBe(true);
    });

    it("measures the spread across all reviews, not just the first two", () => {
      const result = detectDisagreement(input({ scores: [70, 72, 71, 95] }));

      expect(result.flagged).toBe(true);
      expect(result.reasons[0]).toContain("25");
    });

    it("honours a threshold other than the default", () => {
      expect(detectDisagreement(input({ scores: [70, 80], spreadThreshold: 5 })).flagged).toBe(
        true,
      );
      expect(detectDisagreement(input({ scores: [70, 80], spreadThreshold: 50 })).flagged).toBe(
        false,
      );
    });

    it("does not flag unanimous scores", () => {
      const result = detectDisagreement(
        input({ scores: [80, 80, 80], recommendations: recommendations("yes", "yes", "yes") }),
      );

      expect(result.flagged).toBe(false);
    });
  });

  describe("fewer than two scores", () => {
    it("does not flag on spread with no scores at all", () => {
      expect(detectDisagreement(input({ scores: [] })).flagged).toBe(false);
    });

    it("does not flag on spread with a single score, however extreme", () => {
      const result = detectDisagreement(input({ scores: [100], spreadThreshold: 0 }));

      expect(result.flagged).toBe(false);
    });

    it("still flags a manual request when only one review exists", () => {
      const result = detectDisagreement(input({ scores: [100], manuallyRequested: true }));

      expect(result.flagged).toBe(true);
      expect(result.reasons).toEqual(["A committee lead requested an additional review."]);
    });
  });

  describe("extreme recommendation conflicts", () => {
    it("flags a strong yes against a no", () => {
      const result = detectDisagreement(
        input({ recommendations: recommendations("strong_yes", "no") }),
      );

      expect(result.flagged).toBe(true);
      expect(result.reasons[0]).toContain("strong yes");
      expect(result.reasons[0]).toContain("no");
    });

    it("flags a strong yes against a strong no", () => {
      const result = detectDisagreement(
        input({ recommendations: recommendations("strong_yes", "strong_no") }),
      );

      expect(result.flagged).toBe(true);
      expect(result.reasons[0]).toContain("strong no");
    });

    it("flags a yes against a strong no", () => {
      const result = detectDisagreement(
        input({ recommendations: recommendations("yes", "strong_no") }),
      );

      expect(result.flagged).toBe(true);
      expect(result.reasons[0]).toContain("strong no");
    });

    it("does NOT flag a plain yes against a plain no", () => {
      const result = detectDisagreement(input({ recommendations: recommendations("yes", "no") }));

      expect(result.flagged).toBe(false);
      expect(result.reasons).toEqual([]);
    });

    it("does not flag when every reviewer leaned the same way", () => {
      expect(
        detectDisagreement(input({ recommendations: recommendations("strong_yes", "yes") }))
          .flagged,
      ).toBe(false);
      expect(
        detectDisagreement(input({ recommendations: recommendations("strong_no", "no") })).flagged,
      ).toBe(false);
    });

    it("does not treat unsure as an extreme", () => {
      const result = detectDisagreement(
        input({ recommendations: recommendations("unsure", "strong_yes", "unsure") }),
      );

      expect(result.flagged).toBe(false);
    });

    it("does not flag a single recommendation", () => {
      expect(
        detectDisagreement(input({ recommendations: recommendations("strong_no") })).flagged,
      ).toBe(false);
    });

    it("describes every conflicting pair present in one reason", () => {
      const result = detectDisagreement(
        input({ recommendations: recommendations("strong_yes", "no", "strong_no") }),
      );

      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain('a "strong yes" alongside a "no"');
      expect(result.reasons[0]).toContain('a "strong yes" alongside a "strong no"');
    });

    it("does not depend on the order the recommendations arrived in", () => {
      const forwards = detectDisagreement(
        input({ recommendations: recommendations("strong_yes", "no") }),
      );
      const backwards = detectDisagreement(
        input({ recommendations: recommendations("no", "strong_yes") }),
      );

      expect(forwards).toEqual(backwards);
    });

    it("is disabled entirely by flagOnExtremeConflict: false", () => {
      const result = detectDisagreement(
        input({
          recommendations: recommendations("strong_yes", "strong_no"),
          flagOnExtremeConflict: false,
        }),
      );

      expect(result.flagged).toBe(false);
      expect(result.reasons).toEqual([]);
    });

    it("still applies the spread rule when conflict flagging is disabled", () => {
      const result = detectDisagreement(
        input({
          scores: [30, 90],
          recommendations: recommendations("strong_yes", "strong_no"),
          flagOnExtremeConflict: false,
        }),
      );

      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain("60");
    });
  });

  describe("a manually requested review", () => {
    it("flags on its own, with no scores and no recommendations", () => {
      const result = detectDisagreement(input({ manuallyRequested: true }));

      expect(result.flagged).toBe(true);
      expect(result.reasons).toEqual(["A committee lead requested an additional review."]);
    });

    it("does not flag when explicitly false", () => {
      expect(detectDisagreement(input({ manuallyRequested: false })).flagged).toBe(false);
    });

    it("does not flag when omitted", () => {
      expect(detectDisagreement(input({})).flagged).toBe(false);
    });
  });

  describe("accumulating reasons", () => {
    it("reports all three reasons at once", () => {
      const result = detectDisagreement(
        input({
          scores: [30, 95],
          recommendations: recommendations("strong_yes", "strong_no"),
          manuallyRequested: true,
        }),
      );

      expect(result.flagged).toBe(true);
      expect(result.reasons).toHaveLength(3);
      expect(result.reasons[2]).toBe("A committee lead requested an additional review.");
    });

    it("reports spread and conflict together without the manual request", () => {
      const result = detectDisagreement(
        input({ scores: [30, 95], recommendations: recommendations("yes", "strong_no") }),
      );

      expect(result.reasons).toHaveLength(2);
    });

    it("gives every reason as a complete sentence a reviewer can read", () => {
      const result = detectDisagreement(
        input({
          scores: [30, 95],
          recommendations: recommendations("strong_yes", "no"),
          manuallyRequested: true,
        }),
      );

      for (const reason of result.reasons) {
        expect(reason.endsWith(".")).toBe(true);
        expect(reason.length).toBeGreaterThan(20);
        expect(reason[0]).toBe(reason[0]?.toUpperCase());
      }
    });

    it("leaves reasons empty whenever it is not flagged", () => {
      const result = detectDisagreement(
        input({ scores: [80, 82], recommendations: recommendations("yes", "unsure") }),
      );

      expect(result.flagged).toBe(false);
      expect(result.reasons).toEqual([]);
    });
  });
});
