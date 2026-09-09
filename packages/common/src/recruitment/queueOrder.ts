/**
 * The order a reviewer works through their queue.
 *
 * Reviewing is finite: whoever is at the bottom may not get read carefully, or
 * at all. So the order is a policy decision, not a convenience, and it is
 * stated here rather than left to whatever the database returned.
 *
 * Two things the applicant supplied decide who is read at all:
 *
 *   - where they ranked this committee, and
 *   - whether they wrote anything for it.
 *
 * Both must hold. Ranking us in the top three and answering our own questions
 * is the whole gate; among those who pass it, their rank is the order. Neither
 * signal is a judgement the platform formed — both are the applicant's own
 * words, which is what keeps this the right side of the line from scoring
 * people.
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
 * The order applications are read in: the applicant's own rank, 1 to 3.
 *
 * Two things put somebody out of scope entirely, and neither is a tiebreak.
 * Ranking us fourth or lower is one. Writing nothing for us is the other - a
 * committee's questions are the only place an applicant says anything about
 * *this* committee, so leaving all of them blank leaves nothing to review.
 * That is a change: those applicants used to occupy the bottom tiers, which
 * meant 139 of 316 candidacies were work the team would never get to but that
 * still counted against their progress.
 *
 * Out of scope returns `OUT_OF_SCOPE_TIER` rather than throwing, so a caller
 * that forgets to filter sorts them last instead of silently mixing them in.
 */
export function queuePriorityTier(item: QueueOrderable): number {
  const rank = item.applicantRank;
  if (rank === null || rank < 1 || rank > REVIEWABLE_RANKS || !item.hasCommitteeResponse) {
    return OUT_OF_SCOPE_TIER;
  }
  return rank;
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
