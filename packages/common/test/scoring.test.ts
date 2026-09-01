import { describe, expect, it } from "vitest";

import { computeReviewScore } from "../src/recruitment/scoring.ts";
import type { ScoringCriterion } from "../src/recruitment/types.ts";

/**
 * The rubric a new cycle is seeded with: five reviewer criteria plus the
 * applicant's own submitted preference, every one scored 1 to 5.
 */
function defaultRubric(): ScoringCriterion[] {
  return [
    { key: "technical", weight: 0.3, minScore: 1, maxScore: 5, source: "reviewer", active: true },
    {
      key: "communication",
      weight: 0.2,
      minScore: 1,
      maxScore: 5,
      source: "reviewer",
      active: true,
    },
    {
      key: "collaboration",
      weight: 0.2,
      minScore: 1,
      maxScore: 5,
      source: "reviewer",
      active: true,
    },
    { key: "initiative", weight: 0.15, minScore: 1, maxScore: 5, source: "reviewer", active: true },
    { key: "reliability", weight: 0.1, minScore: 1, maxScore: 5, source: "reviewer", active: true },
    {
      key: "preference",
      weight: 0.05,
      minScore: 1,
      maxScore: 5,
      source: "application_preference",
      active: true,
    },
  ];
}

const REVIEWER_KEYS = ["technical", "communication", "collaboration", "initiative", "reliability"];

function allReviewerScores(value: number): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const key of REVIEWER_KEYS) {
    scores[key] = value;
  }

  return scores;
}

describe("computeReviewScore", () => {
  describe("the endpoints of the default rubric", () => {
    it("gives exactly 100 when every score is the maximum", () => {
      const result = computeReviewScore({
        criteria: defaultRubric(),
        scores: allReviewerScores(5),
        preferenceScore: 5,
      });

      expect(result.normalizedScore).toBe(100);
    });

    it("gives exactly 0 when every score is the minimum", () => {
      const result = computeReviewScore({
        criteria: defaultRubric(),
        scores: allReviewerScores(1),
        preferenceScore: 1,
      });

      expect(result.normalizedScore).toBe(0);
    });

    it("gives exactly 50 at the midpoint of every scale", () => {
      const result = computeReviewScore({
        criteria: defaultRubric(),
        scores: allReviewerScores(3),
        preferenceScore: 3,
      });

      expect(result.normalizedScore).toBe(50);
    });

    it("returns one contribution per active criterion, in rubric order", () => {
      const result = computeReviewScore({
        criteria: defaultRubric(),
        scores: allReviewerScores(3),
        preferenceScore: 3,
      });

      expect(result.contributions.map((contribution) => contribution.criterionKey)).toEqual([
        "technical",
        "communication",
        "collaboration",
        "initiative",
        "reliability",
        "preference",
      ]);
    });

    it("puts each criterion's full weight in play at the maximum", () => {
      const result = computeReviewScore({
        criteria: defaultRubric(),
        scores: allReviewerScores(5),
        preferenceScore: 5,
      });

      expect(result.contributions.map((contribution) => contribution.points)).toEqual([
        30, 20, 20, 15, 10, 5,
      ]);
    });
  });

  describe("a hand-computed mixed review", () => {
    // Every criterion runs 1 to 5, so the normalised value is (raw - 1) / 4.
    //   technical      4   -> 0.75  * 0.30 * 100 = 22.5
    //   communication  3   -> 0.5   * 0.20 * 100 = 10
    //   collaboration  5   -> 1     * 0.20 * 100 = 20
    //   initiative     2   -> 0.25  * 0.15 * 100 = 3.75
    //   reliability    1   -> 0     * 0.10 * 100 = 0
    //   preference     4.5 -> 0.875 * 0.05 * 100 = 4.375 -> 4.38
    //                                              total = 60.63
    const input = {
      criteria: defaultRubric(),
      scores: {
        technical: 4,
        communication: 3,
        collaboration: 5,
        initiative: 2,
        reliability: 1,
      },
      preferenceScore: 4.5,
    };

    it("totals to the hand-computed 60.63", () => {
      expect(computeReviewScore(input).normalizedScore).toBe(60.63);
    });

    it("reports each criterion's points exactly as derived by hand", () => {
      const points = computeReviewScore(input).contributions.map(
        (contribution) => contribution.points,
      );

      expect(points).toEqual([22.5, 10, 20, 3.75, 0, 4.38]);
    });

    it("reports each criterion's raw score, weight and normalised value", () => {
      const result = computeReviewScore(input);

      expect(result.contributions[0]).toEqual({
        criterionKey: "technical",
        rawScore: 4,
        weight: 0.3,
        normalizedScore: 0.75,
        points: 22.5,
      });
      expect(result.contributions[3]).toEqual({
        criterionKey: "initiative",
        rawScore: 2,
        weight: 0.15,
        normalizedScore: 0.25,
        points: 3.75,
      });
      expect(result.contributions[5]).toEqual({
        criterionKey: "preference",
        rawScore: 4.5,
        weight: 0.05,
        normalizedScore: 0.875,
        points: 4.38,
      });
    });

    it("shows a breakdown that adds up to the total it is shown beside", () => {
      const result = computeReviewScore(input);
      const sum = result.contributions.reduce(
        (total, contribution) => total + contribution.points,
        0,
      );

      expect(Math.round(sum * 100) / 100).toBe(result.normalizedScore);
    });
  });

  describe("missing and invalid reviewer scores", () => {
    it("throws when a required reviewer score is absent", () => {
      expect(() =>
        computeReviewScore({
          criteria: defaultRubric(),
          scores: { technical: 4, communication: 3, collaboration: 5, initiative: 2 },
          preferenceScore: 5,
        }),
      ).toThrow(/reliability/);
    });

    it("names the missing criterion in the error", () => {
      expect(() =>
        computeReviewScore({
          criteria: defaultRubric(),
          scores: {},
          preferenceScore: 5,
        }),
      ).toThrow(/Missing reviewer score for criterion "technical"/);
    });

    it("throws when a score is above the criterion maximum", () => {
      expect(() =>
        computeReviewScore({
          criteria: defaultRubric(),
          scores: { ...allReviewerScores(3), technical: 6 },
          preferenceScore: 5,
        }),
      ).toThrow(/outside its allowed range of 1 to 5/);
    });

    it("throws when a score is below the criterion minimum", () => {
      expect(() =>
        computeReviewScore({
          criteria: defaultRubric(),
          scores: { ...allReviewerScores(3), reliability: 0 },
          preferenceScore: 5,
        }),
      ).toThrow(/Reviewer score 0 for criterion "reliability"/);
    });

    it("throws rather than substituting a number no reviewer entered", () => {
      expect(() =>
        computeReviewScore({
          criteria: defaultRubric(),
          scores: { ...allReviewerScores(3), technical: Number.NaN },
          preferenceScore: 5,
        }),
      ).toThrow(Error);
    });

    it("accepts scores exactly on the boundaries", () => {
      expect(() =>
        computeReviewScore({
          criteria: defaultRubric(),
          scores: { ...allReviewerScores(3), technical: 1, communication: 5 },
          preferenceScore: 3,
        }),
      ).not.toThrow();
    });

    it("ignores a missing score for an inactive reviewer criterion", () => {
      const criteria = defaultRubric();
      criteria.push({
        key: "retired",
        weight: 0,
        minScore: 1,
        maxScore: 5,
        source: "reviewer",
        active: false,
      });

      expect(() =>
        computeReviewScore({ criteria, scores: allReviewerScores(3), preferenceScore: 3 }),
      ).not.toThrow();
    });
  });

  describe("the applicant's submitted preference", () => {
    it("falls back to the criterion minimum when the applicant did not rank", () => {
      const result = computeReviewScore({
        criteria: defaultRubric(),
        scores: allReviewerScores(5),
        preferenceScore: null,
      });

      // Every reviewer criterion is maxed (95 points) and preference adds none.
      expect(result.normalizedScore).toBe(95);
      expect(result.contributions[5]).toEqual({
        criterionKey: "preference",
        rawScore: 1,
        weight: 0.05,
        normalizedScore: 0,
        points: 0,
      });
    });

    it("does not read the reviewer scores map for a preference criterion", () => {
      const result = computeReviewScore({
        criteria: defaultRubric(),
        scores: { ...allReviewerScores(1), preference: 5 },
        preferenceScore: 1,
      });

      expect(result.normalizedScore).toBe(0);
    });

    it("clamps a preference score configured outside the criterion bounds", () => {
      const result = computeReviewScore({
        criteria: defaultRubric(),
        scores: allReviewerScores(5),
        preferenceScore: 42,
      });

      expect(result.normalizedScore).toBe(100);
    });
  });

  describe("inactive criteria", () => {
    it("excludes an inactive criterion from the contributions", () => {
      const criteria = defaultRubric().map((entry) =>
        entry.key === "reliability" ? { ...entry, active: false } : entry,
      );
      const result = computeReviewScore({
        criteria,
        scores: allReviewerScores(5),
        preferenceScore: 5,
      });

      expect(result.contributions.map((contribution) => contribution.criterionKey)).not.toContain(
        "reliability",
      );
      // The remaining weights sum to 0.9, so the ceiling drops to 90.
      expect(result.normalizedScore).toBe(90);
    });

    it("returns a zero score and no contributions when nothing is active", () => {
      const criteria = defaultRubric().map((entry) => ({ ...entry, active: false }));
      const result = computeReviewScore({ criteria, scores: {}, preferenceScore: null });

      expect(result).toEqual({ normalizedScore: 0, contributions: [] });
    });
  });

  describe("degenerate bounds", () => {
    it("contributes nothing rather than dividing by zero", () => {
      const result = computeReviewScore({
        criteria: [
          { key: "flat", weight: 0.5, minScore: 3, maxScore: 3, source: "reviewer", active: true },
          { key: "real", weight: 0.5, minScore: 1, maxScore: 5, source: "reviewer", active: true },
        ],
        scores: { flat: 3, real: 5 },
        preferenceScore: null,
      });

      expect(result.normalizedScore).toBe(50);
      expect(result.contributions[0]?.normalizedScore).toBe(0);
    });
  });

  it("is pure: the same input always yields the same result", () => {
    const input = {
      criteria: defaultRubric(),
      scores: allReviewerScores(4),
      preferenceScore: 2,
    };

    expect(computeReviewScore(input)).toEqual(computeReviewScore(input));
  });
});
