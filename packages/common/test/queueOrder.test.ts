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
 * The order leadership asked for: the applicant's own rank, 1 to 3.
 *
 * Scope is the interesting part. Ranking us fourth or lower puts somebody out,
 * and so does writing nothing for us - a committee's questions are the only
 * place an applicant says anything about *this* committee, so leaving them all
 * blank leaves nothing to review.
 */
describe("queuePriorityTier", () => {
  it("puts a first choice who wrote for us at the top", () => {
    expect(queuePriorityTier(item("a", 1, true))).toBe(1);
  });

  it("puts a second choice who wrote for us next", () => {
    expect(queuePriorityTier(item("a", 2, true))).toBe(2);
  });

  it("puts a third choice who wrote for us last of those read", () => {
    expect(queuePriorityTier(item("a", 3, true))).toBe(3);
  });

  /**
   * The change from the previous policy. Writing nothing used to cost an
   * applicant a few places; it now takes them out of the pool. Rank no longer
   * rescues them - a first choice who left every Labrador question blank has
   * given the committee nothing to read.
   */
  it("takes a silent applicant out of the pool at every rank", () => {
    for (const rank of [1, 2, 3]) {
      expect(isReviewable(item("a", rank, false))).toBe(false);
    }
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

  it("counts every top-three choice who wrote for us as reviewable", () => {
    for (const rank of [1, 2, 3]) {
      expect(isReviewable(item("a", rank, true))).toBe(true);
    }
  });
});

describe("compareQueueItems", () => {
  it("puts a first choice with an essay above a second choice with one", () => {
    expect(compareQueueItems(item("a", 1, true), item("b", 2, true))).toBeLessThan(0);
  });

  /**
   * Sorted last rather than dropped. `compareQueueItems` orders whatever it is
   * handed; filtering is `isReviewable`'s job, and a caller that forgets it
   * should get these at the bottom, not silently interleaved.
   */
  it("sorts a silent applicant below every applicant who wrote", () => {
    expect(compareQueueItems(item("a", 1, false), item("b", 3, true))).toBeGreaterThan(0);
    expect(compareQueueItems(item("a", 3, true), item("b", 1, false))).toBeLessThan(0);
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

    // The three who wrote, in rank order, then the three who did not - who are
    // out of scope and never handed out at all.
    expect(ordered.map((row) => row.candidacyId)).toEqual([
      "first-essay",
      "second-essay",
      "third-essay",
      "first-silent",
      "second-silent",
      "third-silent",
    ]);
    expect(ordered.filter(isReviewable).map((row) => row.candidacyId)).toEqual([
      "first-essay",
      "second-essay",
      "third-essay",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const input = [item("b", 2, true), item("a", 1, true)];
    const copy = [...input];
    orderQueue(input);
    expect(input).toEqual(copy);
  });
});
