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

/** The deepest rank still worth reading. Beyond this nobody is reviewed. */
export const REVIEWABLE_RANKS = 3;

/** Where an applicant who is out of scope sorts, and is filtered out anyway. */
const OUT_OF_SCOPE_TIER = 99;

export interface QueueOrderable {
  /** The applicant's own rank for this committee. 1 is their first choice. */
  applicantRank: number | null;
  /** Whether they answered any of this committee's own questions. */
  hasCommitteeResponse: boolean;
  /** Stable last resort, so the order never depends on row arrival. */
  candidacyId: string;
}

/**
 * The order applications are read in.
 *
 *   1  ranked first, and wrote for us
 *   2  ranked second, and wrote for us
 *   3  ranked first, wrote nothing
 *   4  ranked second, wrote nothing
 *   5  ranked third, either way
 *
 * Ranked fourth or lower is not read at all, and returns `OUT_OF_SCOPE_TIER`
 * so a caller that forgets to filter still sorts them last rather than
 * silently mixing them in.
 *
 * Wanting us first and saying why outranks wanting us first and saying
 * nothing - but both outrank a third choice, which is the change from the
 * earlier ordering. Previously a third choice who wrote an essay was read
 * before a first choice who did not, on the reasoning that an essay is the
 * stronger signal. Leadership's call is that the ranking comes first: somebody
 * who put us top is who we are trying to recruit, essay or no essay.
 */
export function queuePriorityTier(item: QueueOrderable): number {
  const rank = item.applicantRank;
  if (rank === null || rank < 1 || rank > REVIEWABLE_RANKS) {
    return OUT_OF_SCOPE_TIER;
  }
  if (rank === REVIEWABLE_RANKS) {
    return 5;
  }
  // Ranks 1 and 2, split by whether they wrote anything: 1, 2 with an essay
  // and 3, 4 without.
  return item.hasCommitteeResponse ? rank : rank + 2;
}

/** Whether this candidacy is read at all this cycle. */
export function isReviewable(item: QueueOrderable): boolean {
  return queuePriorityTier(item) !== OUT_OF_SCOPE_TIER;
}

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
