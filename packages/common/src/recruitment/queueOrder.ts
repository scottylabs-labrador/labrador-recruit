/**
 * The order a reviewer works through their queue.
 *
 * Reviewing is finite: whoever is at the bottom may not get read carefully, or
 * at all. So the order is a policy decision, not a convenience, and it is
 * stated here rather than left to whatever the database returned.
 *
 * Two things decide it, both supplied by the applicant:
 *
 *   - where they ranked this committee, and
 *   - whether they wrote anything for it.
 *
 * Someone who put this committee first and answered its questions has told us
 * twice that they want it. Someone who ranked it third and wrote nothing has
 * told us the opposite. Neither signal is a judgement the platform formed —
 * both are the applicant's own words, which is what keeps this the right side
 * of the line from scoring people.
 */

/** Ranks that count as "asked for this committee", when paired with an answer. */
const TOP_RANKS = 3;

/** The bucket everything that is neither top-ranked nor answered falls into. */
const REMAINDER_TIER = TOP_RANKS + 1;

export interface QueueOrderable {
  /** The applicant's own rank for this committee. 1 is their first choice. */
  applicantRank: number | null;
  /** Whether they answered any of this committee's own questions. */
  hasCommitteeResponse: boolean;
  /** Stable last resort, so the order never depends on row arrival. */
  candidacyId: string;
}

/**
 * 1, 2 or 3 for an applicant who both ranked the committee that highly and
 * wrote something for it; 4 for everyone else.
 *
 * Surfaced rather than kept private because the queue displays it: an order
 * a reviewer cannot see the reason for looks arbitrary, and a reviewer who
 * thinks the order is arbitrary will ignore it.
 */
export function queuePriorityTier(item: QueueOrderable): number {
  const rank = item.applicantRank;
  if (!item.hasCommitteeResponse || rank === null || rank < 1 || rank > TOP_RANKS) {
    return REMAINDER_TIER;
  }
  return rank;
}

/**
 * Orders two queue entries. Lower sorts first.
 *
 * Inside the remainder tier, an answer still counts for more than a rank: an
 * applicant who ranked the committee fifth but wrote a page about it is a
 * better use of the next ten minutes than one who ranked it first and left
 * every question blank.
 */
export function compareQueueItems(a: QueueOrderable, b: QueueOrderable): number {
  const tierDelta = queuePriorityTier(a) - queuePriorityTier(b);
  if (tierDelta !== 0) {
    return tierDelta;
  }

  if (a.hasCommitteeResponse !== b.hasCommitteeResponse) {
    return a.hasCommitteeResponse ? -1 : 1;
  }

  // An unranked applicant sorts last rather than first: absent is not the same
  // as eager, and treating null as 0 would put them ahead of a first choice.
  const rankA = a.applicantRank ?? Number.POSITIVE_INFINITY;
  const rankB = b.applicantRank ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  // Codepoint comparison, not `localeCompare`: the order must be reproducible
  // on any machine and in any locale.
  if (a.candidacyId === b.candidacyId) {
    return 0;
  }
  return a.candidacyId < b.candidacyId ? -1 : 1;
}

/** Sorts a copy, leaving the caller's array alone. */
export function orderQueue<T extends QueueOrderable>(items: readonly T[]): T[] {
  return [...items].sort(compareQueueItems);
}
