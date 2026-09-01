import { roundToTwoDecimals } from "./round.ts";
import type {
  CriterionContribution,
  ReviewScoreInput,
  ReviewScoreResult,
  ScoringCriterion,
} from "./types.ts";

/**
 * Turns one reviewer's rubric entries into a 0-100 score, and returns the
 * derivation alongside it.
 *
 * `contributions` is not diagnostic extra: `docs/product-rules.md` §2 requires
 * that every score the platform shows can be reproduced by hand, so the
 * per-criterion raw score, weight, normalised value, and points are part of the
 * result rather than something the interface has to recompute and possibly
 * disagree with.
 *
 * Missing or out-of-range reviewer scores throw instead of being coerced. A
 * silently substituted score would be a number no human entered, which is
 * exactly the thing this package must never produce.
 *
 * Points are rounded per criterion and the total is the sum of those rounded
 * points, so the breakdown a reviewer reads always adds up to the total shown
 * next to it.
 */
export function computeReviewScore(input: ReviewScoreInput): ReviewScoreResult {
  const { criteria, scores, preferenceScore } = input;
  const contributions: CriterionContribution[] = [];

  for (const criterion of criteria) {
    if (!criterion.active) {
      continue;
    }

    const rawScore = resolveRawScore(criterion, scores, preferenceScore);
    const range = criterion.maxScore - criterion.minScore;
    // A zero-width range carries no information, so it contributes nothing
    // rather than dividing by zero. `validateRubric` rejects such a rubric.
    const normalizedScore = range === 0 ? 0 : (rawScore - criterion.minScore) / range;

    contributions.push({
      criterionKey: criterion.key,
      rawScore,
      weight: criterion.weight,
      normalizedScore,
      points: roundToTwoDecimals(normalizedScore * criterion.weight * 100),
    });
  }

  const total = contributions.reduce(function addPoints(sum, contribution) {
    return sum + contribution.points;
  }, 0);

  return { normalizedScore: roundToTwoDecimals(total), contributions };
}

/**
 * Reviewer scores are validated hard; preference scores are clamped. The
 * difference is deliberate: a bad reviewer score means a human entered
 * something impossible and must be told, whereas a preference score is derived
 * from cycle configuration that may be scaled differently from this criterion,
 * and clamping keeps the normalised value inside 0-1.
 */
function resolveRawScore(
  criterion: ScoringCriterion,
  scores: Record<string, number>,
  preferenceScore: number | null,
): number {
  if (criterion.source === "application_preference") {
    if (preferenceScore === null) {
      return criterion.minScore;
    }

    return Math.min(Math.max(preferenceScore, criterion.minScore), criterion.maxScore);
  }

  const entered = scores[criterion.key];

  if (entered === undefined || !Number.isFinite(entered)) {
    throw new Error(
      `Missing reviewer score for criterion "${criterion.key}". ` +
        `Every active reviewer criterion must be scored before a review can be totalled.`,
    );
  }

  if (entered < criterion.minScore || entered > criterion.maxScore) {
    throw new Error(
      `Reviewer score ${entered} for criterion "${criterion.key}" is outside its allowed range ` +
        `of ${criterion.minScore} to ${criterion.maxScore}.`,
    );
  }

  return entered;
}
