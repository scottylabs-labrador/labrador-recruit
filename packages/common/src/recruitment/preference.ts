import type { PreferenceScoreBounds } from "./types.ts";

/**
 * Turns the applicant's own submitted committee ranking into a score.
 *
 * This is the only place applicant-supplied data becomes a number, and it is
 * permitted precisely because the applicant stated the ranking themselves
 * (`docs/product-rules.md` §1). Nothing here reads, parses, or infers anything
 * from written responses.
 *
 * The map is cycle configuration (§7), so an unranked committee, a rank the
 * cycle never configured, and a malformed rank all resolve the same
 * conservative way: the minimum. A missing preference must never advantage an
 * applicant over one who explicitly ranked the committee last.
 */
export function rankToPreferenceScore(
  rank: number | null | undefined,
  preferenceScoreMap: Record<string, number>,
  bounds: PreferenceScoreBounds,
): number {
  const { minScore, maxScore } = bounds;

  if (rank === null || rank === undefined || !Number.isFinite(rank)) {
    return minScore;
  }

  const mapped = preferenceScoreMap[String(rank)];
  if (mapped === undefined || !Number.isFinite(mapped)) {
    return minScore;
  }

  return Math.min(Math.max(mapped, minScore), maxScore);
}
