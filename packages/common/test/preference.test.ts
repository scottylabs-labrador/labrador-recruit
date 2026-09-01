import { describe, expect, it } from "vitest";

import { rankToPreferenceScore } from "../src/recruitment/preference.ts";
import type { PreferenceScoreBounds } from "../src/recruitment/types.ts";

/** The default cycle configuration a committee starts with. */
const DEFAULT_MAP: Record<string, number> = {
  "1": 5,
  "2": 4.5,
  "3": 4,
  "4": 3,
  "5": 2.5,
  "6": 2,
  "7": 1,
};

const DEFAULT_BOUNDS: PreferenceScoreBounds = { minScore: 1, maxScore: 5 };

describe("rankToPreferenceScore", () => {
  describe("the default preference map", () => {
    const cases: [number, number][] = [
      [1, 5],
      [2, 4.5],
      [3, 4],
      [4, 3],
      [5, 2.5],
      [6, 2],
      [7, 1],
    ];

    for (const [rank, expected] of cases) {
      it(`maps rank ${rank} to ${expected}`, () => {
        expect(rankToPreferenceScore(rank, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(expected);
      });
    }

    it("is monotonically non-increasing across ranks 1 through 7", () => {
      const scores = cases.map(([rank]) =>
        rankToPreferenceScore(rank, DEFAULT_MAP, DEFAULT_BOUNDS),
      );

      for (let index = 1; index < scores.length; index += 1) {
        const previous = scores[index - 1] ?? 0;
        const current = scores[index] ?? 0;
        expect(current).toBeLessThan(previous);
      }
    });
  });

  describe("ranks the cycle did not configure", () => {
    it("returns the minimum for a rank above the configured range", () => {
      expect(rankToPreferenceScore(8, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(1);
    });

    it("returns the minimum for rank 0", () => {
      expect(rankToPreferenceScore(0, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(1);
    });

    it("returns the minimum for a negative rank", () => {
      expect(rankToPreferenceScore(-3, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(1);
    });

    it("returns the minimum for a fractional rank that is not a map key", () => {
      expect(rankToPreferenceScore(2.5, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(1);
    });

    it("returns the minimum against an empty map", () => {
      expect(rankToPreferenceScore(1, {}, DEFAULT_BOUNDS)).toBe(1);
    });

    it("does not read inherited object properties as ranks", () => {
      expect(rankToPreferenceScore(Number.NaN, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(1);
      expect(rankToPreferenceScore(Number.POSITIVE_INFINITY, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(1);
    });
  });

  describe("an applicant who did not rank the committee", () => {
    it("returns the minimum for a null rank", () => {
      expect(rankToPreferenceScore(null, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(1);
    });

    it("returns the minimum for an undefined rank", () => {
      expect(rankToPreferenceScore(undefined, DEFAULT_MAP, DEFAULT_BOUNDS)).toBe(1);
    });

    it("never scores an unranked applicant above one who ranked the committee last", () => {
      const unranked = rankToPreferenceScore(null, DEFAULT_MAP, DEFAULT_BOUNDS);
      const rankedLast = rankToPreferenceScore(7, DEFAULT_MAP, DEFAULT_BOUNDS);

      expect(unranked).toBeLessThanOrEqual(rankedLast);
    });
  });

  describe("clamping into the criterion bounds", () => {
    it("clamps a configured score above the maximum down to the maximum", () => {
      expect(rankToPreferenceScore(1, { "1": 99 }, DEFAULT_BOUNDS)).toBe(5);
    });

    it("clamps a configured score below the minimum up to the minimum", () => {
      expect(rankToPreferenceScore(1, { "1": -4 }, DEFAULT_BOUNDS)).toBe(1);
    });

    it("leaves a score already inside the bounds untouched", () => {
      expect(rankToPreferenceScore(1, { "1": 3.25 }, DEFAULT_BOUNDS)).toBe(3.25);
    });

    it("honours bounds other than 1 to 5", () => {
      const bounds: PreferenceScoreBounds = { minScore: 0, maxScore: 10 };

      expect(rankToPreferenceScore(1, DEFAULT_MAP, bounds)).toBe(5);
      expect(rankToPreferenceScore(99, DEFAULT_MAP, bounds)).toBe(0);
      expect(rankToPreferenceScore(1, { "1": 42 }, bounds)).toBe(10);
    });

    it("returns the exact minimum at the boundary", () => {
      expect(rankToPreferenceScore(1, { "1": 1 }, DEFAULT_BOUNDS)).toBe(1);
      expect(rankToPreferenceScore(1, { "1": 5 }, DEFAULT_BOUNDS)).toBe(5);
    });
  });

  it("is pure: repeated calls with the same input give the same answer", () => {
    const first = rankToPreferenceScore(3, DEFAULT_MAP, DEFAULT_BOUNDS);
    const second = rankToPreferenceScore(3, DEFAULT_MAP, DEFAULT_BOUNDS);

    expect(first).toBe(second);
  });

  it("does not mutate the map it is given", () => {
    const map = { ...DEFAULT_MAP };
    rankToPreferenceScore(1, map, DEFAULT_BOUNDS);

    expect(map).toEqual(DEFAULT_MAP);
  });
});
