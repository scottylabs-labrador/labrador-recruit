import { describe, expect, it } from "vitest";

import {
  compareQueueItems,
  isReviewable,
  orderQueue,
  queuePriorityTier,
} from "../src/recruitment/queueOrder.ts";

function item(
  candidacyId: string,
  applicantRank: number | null,
  hasCommitteeResponse: boolean,
): { candidacyId: string; applicantRank: number | null; hasCommitteeResponse: boolean } {
  return { candidacyId, applicantRank, hasCommitteeResponse };
}

/**
 * The order leadership asked for:
 *
 *   1  ranked first, and wrote for us
 *   2  ranked second, and wrote for us
 *   3  ranked first, wrote nothing
 *   4  ranked second, wrote nothing
 *   5  ranked third, either way
 *
 * Ranked fourth or lower is not read at all this cycle.
 */
describe("queuePriorityTier", () => {
  it("puts a first choice who wrote for us at the top", () => {
    expect(queuePriorityTier(item("a", 1, true))).toBe(1);
  });

  it("puts a second choice who wrote for us next", () => {
    expect(queuePriorityTier(item("a", 2, true))).toBe(2);
  });

  /**
   * The change from the previous policy. A first choice who wrote nothing used
   * to fall behind every essay; the ranking now leads, because somebody who put
   * us top is who we are trying to recruit.
   */
  it("keeps a silent first choice ahead of any third choice", () => {
    expect(queuePriorityTier(item("a", 1, false))).toBe(3);
    expect(queuePriorityTier(item("b", 3, true))).toBe(5);
    expect(queuePriorityTier(item("a", 1, false))).toBeLessThan(
      queuePriorityTier(item("b", 3, true)),
    );
  });

  it("puts a silent second choice fourth", () => {
    expect(queuePriorityTier(item("a", 2, false))).toBe(4);
  });

  it("puts a third choice last, essay or not", () => {
    expect(queuePriorityTier(item("a", 3, true))).toBe(5);
    expect(queuePriorityTier(item("b", 3, false))).toBe(5);
  });

  it("treats a fourth choice or lower as out of scope", () => {
    expect(isReviewable(item("a", 4, true))).toBe(false);
    expect(isReviewable(item("b", 7, true))).toBe(false);
  });

  /** A candidacy held only because they answered our questions is not read. */
  it("treats an unranked applicant as out of scope even with answers", () => {
    expect(isReviewable(item("a", null, true))).toBe(false);
  });

  it("ignores a nonsense rank rather than trusting it", () => {
    expect(isReviewable(item("a", 0, true))).toBe(false);
    expect(isReviewable(item("b", -1, true))).toBe(false);
  });

  it("counts every top-three choice as reviewable", () => {
    for (const rank of [1, 2, 3]) {
      expect(isReviewable(item("a", rank, false))).toBe(true);
    }
  });
});

describe("compareQueueItems", () => {
  it("puts a first choice with an essay above a second choice with one", () => {
    expect(compareQueueItems(item("a", 1, true), item("b", 2, true))).toBeLessThan(0);
  });

  it("puts a silent first choice above a second choice who wrote for us", () => {
    // Tier 3 against tier 2: the essay still wins here, because rank 2 with an
    // essay is asked for before rank 1 without one.
    expect(compareQueueItems(item("a", 1, false), item("b", 2, true))).toBeGreaterThan(0);
  });

  it("puts a silent second choice above any third choice", () => {
    expect(compareQueueItems(item("a", 2, false), item("b", 3, true))).toBeLessThan(0);
  });

  it("prefers an essay between two third choices", () => {
    expect(compareQueueItems(item("a", 3, true), item("b", 3, false))).toBeLessThan(0);
  });

  it("breaks a complete tie reproducibly, without locale", () => {
    expect(compareQueueItems(item("a", 1, true), item("b", 1, true))).toBeLessThan(0);
    expect(compareQueueItems(item("b", 1, true), item("a", 1, true))).toBeGreaterThan(0);
    expect(compareQueueItems(item("a", 1, true), item("a", 1, true))).toBe(0);
  });
});

describe("orderQueue", () => {
  it("produces the order leadership asked for", () => {
    const ordered = orderQueue([
      item("third-silent", 3, false),
      item("second-silent", 2, false),
      item("first-silent", 1, false),
      item("third-essay", 3, true),
      item("second-essay", 2, true),
      item("first-essay", 1, true),
    ]);

    expect(ordered.map((row) => row.candidacyId)).toEqual([
      "first-essay",
      "second-essay",
      "first-silent",
      "second-silent",
      "third-essay",
      "third-silent",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const input = [item("b", 2, true), item("a", 1, true)];
    const copy = [...input];
    orderQueue(input);
    expect(input).toEqual(copy);
  });
});
