import type { RankableCandidacy, RankedCandidacy } from "./types.ts";

/**
 * Orders a committee's candidacies and assigns competition ranks.
 *
 * The sort is a configured formula over human review data, which
 * `docs/product-rules.md` §1 permits, and it produces an ordering only — never
 * a decision. Nothing here accepts, rejects, or cuts off; a rank is a reading
 * order for the humans who decide.
 *
 * Tiebreakers run in this order, and each one answers a question the previous
 * one left open:
 * 1. Mean score descending, unreviewed last. An absent mean is not a low score,
 *    but a candidacy nobody has reviewed cannot be placed above one that people
 *    have, so it sorts to the bottom rather than to zero.
 * 2. Submitted review count descending. Between equal means, the one backed by
 *    more independent reviews is the better-evidenced number.
 * 3. The applicant's own submitted rank ascending, unranked last. This is the
 *    applicant's stated preference, not an inference about them.
 * 4. Applicant name ascending, by plain codepoint comparison. `localeCompare`
 *    is avoided on purpose: its result depends on the machine's locale and ICU
 *    data, so the same input could rank differently on a developer's laptop
 *    than on the server. A ranking that is not reproducible is not auditable.
 * 5. Candidacy id, purely so two applicants who share a name still sort
 *    identically no matter what order the rows arrived in.
 *
 * Ties share a rank and the following rank skips (1, 2, 2, 4), because tied
 * candidacies really are indistinguishable to the committee on every ranking
 * signal. Name and id break the display order but deliberately do not break a
 * tie — being alphabetically earlier is not a reason to outrank someone.
 */
export function rankCandidacies(rows: RankableCandidacy[]): RankedCandidacy[] {
  const sorted = [...rows].sort(compareCandidacies);

  const ranks: number[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = sorted[index - 1];
    const previousRank = ranks[index - 1];

    if (
      current !== undefined &&
      previous !== undefined &&
      previousRank !== undefined &&
      isTiedWith(current, previous)
    ) {
      ranks.push(previousRank);
    } else {
      ranks.push(index + 1);
    }
  }

  return sorted.map(function toRanked(row, index) {
    const rank = ranks[index] ?? index + 1;
    const sharesRankBefore = index > 0 && ranks[index - 1] === rank;
    const sharesRankAfter = index + 1 < ranks.length && ranks[index + 1] === rank;

    return { ...row, rank, tied: sharesRankBefore || sharesRankAfter };
  });
}

/** The three signals that make two rows genuinely indistinguishable. */
function isTiedWith(a: RankableCandidacy, b: RankableCandidacy): boolean {
  return (
    a.meanScore === b.meanScore &&
    a.submittedReviewCount === b.submittedReviewCount &&
    a.applicantRank === b.applicantRank
  );
}

function compareCandidacies(a: RankableCandidacy, b: RankableCandidacy): number {
  const byMeanScore = compareNullableDescending(a.meanScore, b.meanScore);
  if (byMeanScore !== 0) {
    return byMeanScore;
  }

  if (a.submittedReviewCount !== b.submittedReviewCount) {
    return b.submittedReviewCount - a.submittedReviewCount;
  }

  const byApplicantRank = compareNullableAscending(a.applicantRank, b.applicantRank);
  if (byApplicantRank !== 0) {
    return byApplicantRank;
  }

  const byName = compareStrings(a.applicantName, b.applicantName);
  if (byName !== 0) {
    return byName;
  }

  return compareStrings(a.candidacyId, b.candidacyId);
}

/** Higher first, with null sorting after every real value. */
function compareNullableDescending(a: number | null, b: number | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }

  return b - a;
}

/** Lower first, with null sorting after every real value. */
function compareNullableAscending(a: number | null, b: number | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }

  return a - b;
}

/** Codepoint comparison, so the result never depends on the host's locale. */
function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }

  return 0;
}
