import { describe, expect, it } from "vitest";

import { computeAggregate } from "../src/recruitment/aggregate.ts";

describe("computeAggregate", () => {
  describe("a three-review candidacy", () => {
    const result = computeAggregate([91, 88, 55]);

    it("counts the reviews", () => {
      expect(result.count).toBe(3);
    });

    it("averages to 78", () => {
      // (91 + 88 + 55) / 3 = 234 / 3 = 78
      expect(result.mean).toBe(78);
    });

    it("takes the middle value as the median", () => {
      expect(result.median).toBe(88);
    });

    it("reports the extremes", () => {
      expect(result.min).toBe(55);
      expect(result.max).toBe(91);
    });

    it("spreads 36 points", () => {
      expect(result.spread).toBe(36);
    });

    it("reports a standard deviation once two reviews exist", () => {
      expect(result.standardDeviation).not.toBeNull();
    });
  });

  describe("no reviews yet", () => {
    it("reports a count of zero and no statistics", () => {
      expect(computeAggregate([])).toEqual({
        count: 0,
        mean: null,
        median: null,
        min: null,
        max: null,
        spread: null,
        standardDeviation: null,
      });
    });
  });

  describe("a single review", () => {
    const result = computeAggregate([73]);

    it("reports the one score as mean, median, min and max", () => {
      expect(result.count).toBe(1);
      expect(result.mean).toBe(73);
      expect(result.median).toBe(73);
      expect(result.min).toBe(73);
      expect(result.max).toBe(73);
    });

    it("leaves spread and standard deviation null rather than showing zero", () => {
      // A displayed 0 would read as "the reviewers agree", which is not known.
      expect(result.spread).toBeNull();
      expect(result.standardDeviation).toBeNull();
    });
  });

  describe("the median", () => {
    it("averages the two middle values for an even count", () => {
      // Sorted: 60, 70, 80, 90 -> (70 + 80) / 2 = 75
      expect(computeAggregate([90, 60, 80, 70]).median).toBe(75);
    });

    it("can land between whole numbers", () => {
      // Sorted: 70, 81 -> 75.5
      expect(computeAggregate([81, 70]).median).toBe(75.5);
    });

    it("does not depend on the order the reviews arrived in", () => {
      expect(computeAggregate([55, 91, 88]).median).toBe(88);
      expect(computeAggregate([88, 55, 91]).median).toBe(88);
      expect(computeAggregate([91, 88, 55]).median).toBe(88);
    });

    it("takes the middle value for an odd count", () => {
      expect(computeAggregate([10, 20, 30, 40, 50]).median).toBe(30);
    });
  });

  describe("the population standard deviation", () => {
    it("matches a textbook hand calculation", () => {
      // [2, 4, 4, 4, 5, 5, 7, 9] has mean 5 and squared deviations
      // 9 + 1 + 1 + 1 + 0 + 0 + 4 + 16 = 32. 32 / 8 = 4, and sqrt(4) = 2.
      const result = computeAggregate([2, 4, 4, 4, 5, 5, 7, 9]);

      expect(result.mean).toBe(5);
      expect(result.median).toBe(4.5);
      expect(result.min).toBe(2);
      expect(result.max).toBe(9);
      expect(result.spread).toBe(7);
      expect(result.standardDeviation).toBe(2);
    });

    it("divides by N, not by N minus 1", () => {
      // [0, 10]: mean 5, squared deviations 25 + 25 = 50.
      // Population: sqrt(50 / 2) = 5. Sample would be sqrt(50 / 1) = 7.07.
      expect(computeAggregate([0, 10]).standardDeviation).toBe(5);
    });

    it("is zero when every reviewer landed on the same score", () => {
      const result = computeAggregate([80, 80, 80]);

      expect(result.standardDeviation).toBe(0);
      expect(result.spread).toBe(0);
    });
  });

  describe("rounding", () => {
    it("rounds the mean to two decimals", () => {
      // (1 + 2 + 2) / 3 = 1.6666...
      expect(computeAggregate([1, 2, 2]).mean).toBe(1.67);
    });

    it("rounds the standard deviation to two decimals", () => {
      // [1, 2, 3, 4]: mean 2.5, squared deviations 2.25 + 0.25 + 0.25 + 2.25 = 5.
      // sqrt(5 / 4) = 1.118033... -> 1.12
      expect(computeAggregate([1, 2, 3, 4]).standardDeviation).toBe(1.12);
    });

    it("reports min and max exactly as recorded", () => {
      const result = computeAggregate([12.345, 90.987]);

      expect(result.min).toBe(12.345);
      expect(result.max).toBe(90.987);
    });

    it("rounds the spread of unrounded extremes", () => {
      expect(computeAggregate([12.345, 90.987]).spread).toBe(78.64);
    });
  });

  describe("purity", () => {
    it("does not mutate the array it is given", () => {
      const scores = [91, 88, 55];
      computeAggregate(scores);

      expect(scores).toEqual([91, 88, 55]);
    });

    it("returns the same statistics however the reviews are ordered", () => {
      expect(computeAggregate([55, 88, 91])).toEqual(computeAggregate([91, 55, 88]));
    });
  });

  describe("negative and zero scores", () => {
    it("handles a candidacy where every reviewer scored zero", () => {
      const result = computeAggregate([0, 0]);

      expect(result.mean).toBe(0);
      expect(result.spread).toBe(0);
      expect(result.standardDeviation).toBe(0);
    });
  });
});
