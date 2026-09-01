/**
 * Value types for the deterministic recruitment math.
 *
 * Everything in `packages/common/src/recruitment` is a pure function over these
 * types: no database, no network, no clock. That is what makes the scoring
 * auditable, which `docs/product-rules.md` requires. None of this code ever
 * sees applicant essay text.
 */

export type RecommendationValue = "strong_yes" | "yes" | "unsure" | "no" | "strong_no";

export type ConfidenceValue = "high" | "medium" | "low";

export type CriterionSourceValue = "reviewer" | "application_preference";

/**
 * The range a preference score is clamped into. Kept separate from the map
 * itself because the map is cycle configuration while the bounds belong to the
 * rubric criterion the score feeds.
 */
export interface PreferenceScoreBounds {
  minScore: number;
  maxScore: number;
}

/** A rubric criterion reduced to only what the math needs. */
export interface ScoringCriterion {
  key: string;
  /** Fraction of 1. The active criteria of a rubric must sum to 1. */
  weight: number;
  minScore: number;
  maxScore: number;
  source: CriterionSourceValue;
  active: boolean;
}

/** What one criterion contributed to a review's normalised score. */
export interface CriterionContribution {
  criterionKey: string;
  /** The score as entered, on the criterion's own scale. */
  rawScore: number;
  weight: number;
  /** `rawScore` rescaled to 0-1 by the criterion's own bounds. */
  normalizedScore: number;
  /** `normalizedScore * weight * 100`, the points this criterion added. */
  points: number;
}

/**
 * Everything one review score needs. There is deliberately no field for essay
 * text: the math can only ever see numbers a human entered plus the preference
 * the applicant submitted themselves.
 */
export interface ReviewScoreInput {
  criteria: ScoringCriterion[];
  /** Reviewer-entered scores, keyed by `ScoringCriterion.key`. */
  scores: Record<string, number>;
  /** Null when the applicant did not rank this committee. */
  preferenceScore: number | null;
}

/**
 * A single reviewer's score, plus the per-criterion breakdown that lets the
 * interface show exactly how the number was reached.
 */
export interface ReviewScoreResult {
  /** The weighted total, normalised to 0-100. */
  normalizedScore: number;
  contributions: CriterionContribution[];
}

/** Descriptive statistics over the submitted reviews of one candidacy. */
export interface AggregateResult {
  /** Number of submitted reviews contributing to these statistics. */
  count: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  /** `max - min`. Null when fewer than two reviews exist. */
  spread: number | null;
  /** Population standard deviation. Null when fewer than two reviews exist. */
  standardDeviation: number | null;
}

/** Why a candidacy was flagged, stated plainly enough to show a reviewer. */
export interface DisagreementResult {
  flagged: boolean;
  /** Human-readable reasons. Empty when not flagged. */
  reasons: string[];
}

export interface DisagreementInput {
  scores: number[];
  recommendations: RecommendationValue[];
  /** Spread, in normalised points, at or above which reviewers disagree. */
  spreadThreshold: number;
  /** Flag when recommendations span a positive and a negative extreme. */
  flagOnExtremeConflict: boolean;
  /** A committee lead may request another review regardless of the numbers. */
  manuallyRequested?: boolean;
}

/** One row of a committee ranking, before sorting. */
export interface RankableCandidacy {
  candidacyId: string;
  /** Null when no reviews have been submitted yet. */
  meanScore: number | null;
  submittedReviewCount: number;
  /** The applicant's own rank for this committee; 1 is their first choice. */
  applicantRank: number | null;
  /** Stable final tiebreaker, so ordering never depends on input order. */
  applicantName: string;
}

export interface RankedCandidacy extends RankableCandidacy {
  /** 1-based. Tied rows share a rank, and the next rank skips accordingly. */
  rank: number;
  /** True when this row shares its score with an adjacent row. */
  tied: boolean;
}

/** A validation problem with a rubric, reported rather than thrown. */
export interface RubricValidationIssue {
  code:
    | "weights_do_not_sum_to_one"
    | "negative_weight"
    | "invalid_bounds"
    | "duplicate_key"
    | "no_active_criteria";
  message: string;
  criterionKey?: string;
}

export interface RubricValidationResult {
  valid: boolean;
  issues: RubricValidationIssue[];
}
