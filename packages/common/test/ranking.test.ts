import { describe, expect, it } from "vitest";

import { rankCandidacies } from "../src/recruitment/ranking.ts";
import type { RankableCandidacy } from "../src/recruitment/types.ts";

function row(overrides: Partial<RankableCandidacy> & { candidacyId: string }): RankableCandidacy {
  return {
    meanScore: 80,
    submittedReviewCount: 2,
    applicantRank: 1,
    applicantName: overrides.candidacyId,
    ...overrides,
  };
}

function idsOf(rows: { candidacyId: string }[]): string[] {
  return rows.map((entry) => entry.candidacyId);
}

/** Every distinct permutation-ish reordering worth checking for determinism. */
function reorderings<T>(rows: T[]): T[][] {
  return [
    [...rows],
    [...rows].reverse(),
    [...rows].slice(1).concat(rows.slice(0, 1)),
    [...rows].slice(-1).concat(rows.slice(0, -1)),
    [...rows].sort(() => 1),
    [...rows].sort(() => -1),
  ];
}

describe("rankCandidacies", () => {
  it("returns an empty list unchanged", () => {
    expect(rankCandidacies([])).toEqual([]);
  });

  it("ranks a single candidacy first and untied", () => {
    const result = rankCandidacies([row({ candidacyId: "a" })]);

    expect(result).toHaveLength(1);
    expect(result[0]?.rank).toBe(1);
    expect(result[0]?.tied).toBe(false);
  });

  it("preserves every field of the input row", () => {
    const input = row({
      candidacyId: "a",
      meanScore: 77.5,
      submittedReviewCount: 3,
      applicantRank: 2,
      applicantName: "Ada",
    });
    const result = rankCandidacies([input]);

    expect(result[0]).toEqual({ ...input, rank: 1, tied: false });
  });

  describe("primary ordering by mean score", () => {
    it("puts the highest mean first", () => {
      const result = rankCandidacies([
        row({ candidacyId: "low", meanScore: 60 }),
        row({ candidacyId: "high", meanScore: 95 }),
        row({ candidacyId: "mid", meanScore: 78 }),
      ]);

      expect(idsOf(result)).toEqual(["high", "mid", "low"]);
      expect(result.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    });

    it("sorts unreviewed candidacies below every reviewed one", () => {
      const result = rankCandidacies([
        row({ candidacyId: "unreviewed", meanScore: null, submittedReviewCount: 0 }),
        row({ candidacyId: "barely", meanScore: 0.5 }),
      ]);

      expect(idsOf(result)).toEqual(["barely", "unreviewed"]);
    });

    it("does not treat a null mean as a zero", () => {
      const result = rankCandidacies([
        row({ candidacyId: "unreviewed", meanScore: null, submittedReviewCount: 0 }),
        row({ candidacyId: "zero", meanScore: 0 }),
      ]);

      expect(idsOf(result)).toEqual(["zero", "unreviewed"]);
    });

    it("orders several unreviewed candidacies among themselves by the later keys", () => {
      const result = rankCandidacies([
        row({
          candidacyId: "b",
          meanScore: null,
          submittedReviewCount: 0,
          applicantRank: 3,
          applicantName: "Bo",
        }),
        row({
          candidacyId: "a",
          meanScore: null,
          submittedReviewCount: 0,
          applicantRank: 1,
          applicantName: "Al",
        }),
      ]);

      expect(idsOf(result)).toEqual(["a", "b"]);
    });
  });

  describe("tiebreak by submitted review count", () => {
    it("prefers the better-evidenced mean", () => {
      const result = rankCandidacies([
        row({ candidacyId: "thin", meanScore: 85, submittedReviewCount: 1 }),
        row({ candidacyId: "thick", meanScore: 85, submittedReviewCount: 4 }),
      ]);

      expect(idsOf(result)).toEqual(["thick", "thin"]);
      expect(result.map((entry) => entry.rank)).toEqual([1, 2]);
    });

    it("does not override the mean score", () => {
      const result = rankCandidacies([
        row({ candidacyId: "manyReviews", meanScore: 70, submittedReviewCount: 9 }),
        row({ candidacyId: "fewReviews", meanScore: 90, submittedReviewCount: 1 }),
      ]);

      expect(idsOf(result)).toEqual(["fewReviews", "manyReviews"]);
    });
  });

  describe("tiebreak by the applicant's own rank", () => {
    it("puts a first choice above a third choice", () => {
      const result = rankCandidacies([
        row({ candidacyId: "third", applicantRank: 3 }),
        row({ candidacyId: "first", applicantRank: 1 }),
      ]);

      expect(idsOf(result)).toEqual(["first", "third"]);
    });

    it("puts an unranked applicant last among otherwise equal rows", () => {
      const result = rankCandidacies([
        row({ candidacyId: "unranked", applicantRank: null }),
        row({ candidacyId: "seventh", applicantRank: 7 }),
      ]);

      expect(idsOf(result)).toEqual(["seventh", "unranked"]);
    });
  });

  describe("final tiebreak by applicant name", () => {
    it("orders equal rows alphabetically", () => {
      const result = rankCandidacies([
        row({ candidacyId: "c", applicantName: "Cara" }),
        row({ candidacyId: "a", applicantName: "Ada" }),
        row({ candidacyId: "b", applicantName: "Bo" }),
      ]);

      expect(idsOf(result)).toEqual(["a", "b", "c"]);
    });

    it("compares by codepoint, not by locale collation", () => {
      // Under a locale-aware comparison "Ä" sorts next to "A"; by codepoint it
      // sorts after "Z". The codepoint answer is the one that is reproducible.
      const result = rankCandidacies([
        row({ candidacyId: "diaeresis", applicantName: "Ä" }),
        row({ candidacyId: "zed", applicantName: "Z" }),
      ]);

      expect(idsOf(result)).toEqual(["zed", "diaeresis"]);
    });

    it("does not let the name break the tie itself", () => {
      const result = rankCandidacies([
        row({ candidacyId: "b", applicantName: "Bo" }),
        row({ candidacyId: "a", applicantName: "Ada" }),
      ]);

      expect(result.map((entry) => entry.rank)).toEqual([1, 1]);
      expect(result.map((entry) => entry.tied)).toEqual([true, true]);
    });

    it("falls back to the candidacy id when two applicants share a name", () => {
      const result = rankCandidacies([
        row({ candidacyId: "z", applicantName: "Sam Lee" }),
        row({ candidacyId: "a", applicantName: "Sam Lee" }),
      ]);

      expect(idsOf(result)).toEqual(["a", "z"]);
    });
  });

  describe("competition ranking", () => {
    it("shares a rank among tied rows and skips the next rank", () => {
      const result = rankCandidacies([
        row({ candidacyId: "a", meanScore: 90, applicantName: "Ada" }),
        row({ candidacyId: "b", meanScore: 80, applicantName: "Bo" }),
        row({ candidacyId: "c", meanScore: 80, applicantName: "Cara" }),
        row({ candidacyId: "d", meanScore: 70, applicantName: "Dee" }),
      ]);

      expect(idsOf(result)).toEqual(["a", "b", "c", "d"]);
      expect(result.map((entry) => entry.rank)).toEqual([1, 2, 2, 4]);
    });

    it("marks only the rows that actually share a rank as tied", () => {
      const result = rankCandidacies([
        row({ candidacyId: "a", meanScore: 90, applicantName: "Ada" }),
        row({ candidacyId: "b", meanScore: 80, applicantName: "Bo" }),
        row({ candidacyId: "c", meanScore: 80, applicantName: "Cara" }),
        row({ candidacyId: "d", meanScore: 70, applicantName: "Dee" }),
      ]);

      expect(result.map((entry) => entry.tied)).toEqual([false, true, true, false]);
    });

    it("handles a three-way tie", () => {
      const result = rankCandidacies([
        row({ candidacyId: "a", meanScore: 80, applicantName: "Ada" }),
        row({ candidacyId: "b", meanScore: 80, applicantName: "Bo" }),
        row({ candidacyId: "c", meanScore: 80, applicantName: "Cara" }),
        row({ candidacyId: "d", meanScore: 40, applicantName: "Dee" }),
      ]);

      expect(result.map((entry) => entry.rank)).toEqual([1, 1, 1, 4]);
      expect(result.map((entry) => entry.tied)).toEqual([true, true, true, false]);
    });

    it("does not tie rows that differ in review count", () => {
      const result = rankCandidacies([
        row({ candidacyId: "a", meanScore: 80, submittedReviewCount: 3, applicantName: "Ada" }),
        row({ candidacyId: "b", meanScore: 80, submittedReviewCount: 2, applicantName: "Bo" }),
      ]);

      expect(result.map((entry) => entry.rank)).toEqual([1, 2]);
      expect(result.map((entry) => entry.tied)).toEqual([false, false]);
    });

    it("does not tie rows that differ in the applicant's own rank", () => {
      const result = rankCandidacies([
        row({ candidacyId: "a", applicantRank: 1, applicantName: "Ada" }),
        row({ candidacyId: "b", applicantRank: 2, applicantName: "Bo" }),
      ]);

      expect(result.map((entry) => entry.rank)).toEqual([1, 2]);
      expect(result.map((entry) => entry.tied)).toEqual([false, false]);
    });

    it("ties two unreviewed candidacies with the same applicant rank", () => {
      const result = rankCandidacies([
        row({
          candidacyId: "a",
          meanScore: null,
          submittedReviewCount: 0,
          applicantRank: null,
          applicantName: "Ada",
        }),
        row({
          candidacyId: "b",
          meanScore: null,
          submittedReviewCount: 0,
          applicantRank: null,
          applicantName: "Bo",
        }),
      ]);

      expect(result.map((entry) => entry.rank)).toEqual([1, 1]);
      expect(result.map((entry) => entry.tied)).toEqual([true, true]);
    });

    it("ends the tie group when the next row differs", () => {
      const result = rankCandidacies([
        row({ candidacyId: "a", meanScore: 90, applicantName: "Ada" }),
        row({ candidacyId: "b", meanScore: 90, applicantName: "Bo" }),
        row({ candidacyId: "c", meanScore: 90, applicantName: "Cara" }),
        row({ candidacyId: "d", meanScore: 90, submittedReviewCount: 1, applicantName: "Dee" }),
        row({ candidacyId: "e", meanScore: 90, submittedReviewCount: 1, applicantName: "Eve" }),
      ]);

      expect(result.map((entry) => entry.rank)).toEqual([1, 1, 1, 4, 4]);
      expect(result.map((entry) => entry.tied)).toEqual([true, true, true, true, true]);
    });
  });

  describe("determinism", () => {
    const roster: RankableCandidacy[] = [
      row({
        candidacyId: "c1",
        meanScore: 92.5,
        submittedReviewCount: 3,
        applicantRank: 1,
        applicantName: "Ada",
      }),
      row({
        candidacyId: "c2",
        meanScore: 92.5,
        submittedReviewCount: 3,
        applicantRank: 1,
        applicantName: "Bo",
      }),
      row({
        candidacyId: "c3",
        meanScore: 92.5,
        submittedReviewCount: 2,
        applicantRank: 1,
        applicantName: "Cara",
      }),
      row({
        candidacyId: "c4",
        meanScore: 71,
        submittedReviewCount: 4,
        applicantRank: 2,
        applicantName: "Dee",
      }),
      row({
        candidacyId: "c5",
        meanScore: 71,
        submittedReviewCount: 4,
        applicantRank: null,
        applicantName: "Eve",
      }),
      row({
        candidacyId: "c6",
        meanScore: null,
        submittedReviewCount: 0,
        applicantRank: 1,
        applicantName: "Fay",
      }),
      row({
        candidacyId: "c7",
        meanScore: null,
        submittedReviewCount: 0,
        applicantRank: null,
        applicantName: "Gus",
      }),
    ];

    const expected = rankCandidacies(roster);

    it("produces the documented ordering", () => {
      expect(idsOf(expected)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
      expect(expected.map((entry) => entry.rank)).toEqual([1, 1, 3, 4, 5, 6, 7]);
      expect(expected.map((entry) => entry.tied)).toEqual([
        true,
        true,
        false,
        false,
        false,
        false,
        false,
      ]);
    });

    it("gives the identical result for every reordering of the input", () => {
      for (const shuffled of reorderings(roster)) {
        expect(rankCandidacies(shuffled)).toEqual(expected);
      }
    });

    it("does not mutate the array it is given", () => {
      const rows = [...roster].reverse();
      const snapshot = idsOf(rows);
      rankCandidacies(rows);

      expect(idsOf(rows)).toEqual(snapshot);
    });

    it("is stable across repeated calls", () => {
      expect(rankCandidacies(roster)).toEqual(rankCandidacies(roster));
    });
  });
});
