import { describe, expect, it } from "vitest";

import { compareQueueItems, orderQueue, queuePriorityTier } from "../src/recruitment/queueOrder.ts";

function item(
  candidacyId: string,
  applicantRank: number | null,
  hasCommitteeResponse: boolean,
): { candidacyId: string; applicantRank: number | null; hasCommitteeResponse: boolean } {
  return { candidacyId, applicantRank, hasCommitteeResponse };
}

describe("queuePriorityTier", () => {
  it("gives a ranked applicant who answered the committee's questions their own rank", () => {
    expect(queuePriorityTier(item("a", 1, true))).toBe(1);
    expect(queuePriorityTier(item("a", 2, true))).toBe(2);
    expect(queuePriorityTier(item("a", 3, true))).toBe(3);
  });

  it("drops a top-ranked applicant who wrote nothing into the remainder", () => {
    expect(queuePriorityTier(item("a", 1, false))).toBe(4);
  });

  it("drops an applicant who answered but ranked the committee low into the remainder", () => {
    expect(queuePriorityTier(item("a", 5, true))).toBe(4);
  });

  it("treats an unranked applicant as remainder even with answers", () => {
    expect(queuePriorityTier(item("a", null, true))).toBe(4);
  });

  it("ignores a nonsense rank rather than trusting it", () => {
    expect(queuePriorityTier(item("a", 0, true))).toBe(4);
    expect(queuePriorityTier(item("a", -1, true))).toBe(4);
  });
});

describe("compareQueueItems", () => {
  it("puts a first choice with answers above a second choice with answers", () => {
    expect(compareQueueItems(item("a", 1, true), item("b", 2, true))).toBeLessThan(0);
  });

  it("puts any answered top-three above every unanswered application", () => {
    expect(compareQueueItems(item("a", 3, true), item("b", 1, false))).toBeLessThan(0);
  });

  /**
   * The case the tiers alone do not cover: inside the remainder, an applicant
   * who wrote a page but ranked the committee fifth is a better use of the next
   * ten minutes than one who ranked it first and left every question blank.
   */
  it("prefers an answer over a rank inside the remainder", () => {
    expect(compareQueueItems(item("a", 5, true), item("b", 1, false))).toBeLessThan(0);
  });

  it("orders unanswered applications by the rank they gave", () => {
    expect(compareQueueItems(item("a", 1, false), item("b", 4, false))).toBeLessThan(0);
  });

  it("sorts an unranked applicant last rather than first", () => {
    expect(compareQueueItems(item("a", 7, false), item("b", null, false))).toBeLessThan(0);
  });

  it("breaks a complete tie reproducibly, without locale", () => {
    expect(compareQueueItems(item("a", 1, true), item("b", 1, true))).toBeLessThan(0);
    expect(compareQueueItems(item("b", 1, true), item("a", 1, true))).toBeGreaterThan(0);
    expect(compareQueueItems(item("a", 1, true), item("a", 1, true))).toBe(0);
  });
});

describe("orderQueue", () => {
  it("produces the order Labrador asked for", () => {
    const queue = [
      item("no-essay-rank-1", 1, false),
      item("essay-rank-3", 3, true),
      item("essay-rank-1", 1, true),
      item("no-essay-unranked", null, false),
      item("essay-rank-2", 2, true),
      item("no-essay-rank-2", 2, false),
      item("essay-rank-5", 5, true),
    ];

    expect(orderQueue(queue).map((row) => row.candidacyId)).toEqual([
      "essay-rank-1",
      "essay-rank-2",
      "essay-rank-3",
      "essay-rank-5",
      "no-essay-rank-1",
      "no-essay-rank-2",
      "no-essay-unranked",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const queue = [item("b", 2, true), item("a", 1, true)];
    orderQueue(queue);
    expect(queue.map((row) => row.candidacyId)).toEqual(["b", "a"]);
  });
});
