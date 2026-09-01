import { computeAggregate } from "./aggregate.ts";
import type { DisagreementInput, DisagreementResult, RecommendationValue } from "./types.ts";

/**
 * Recommendation pairs that count as reviewers landing on opposite extremes.
 *
 * A plain "yes" against a plain "no" is ordinary committee disagreement and is
 * deliberately absent: flagging it would flag most candidacies and the flag
 * would stop meaning anything. At least one side must be a "strong" for the
 * conflict to be worth a lead's attention. Order is fixed so the reasons a
 * committee lead reads never depend on the order reviews were submitted in.
 */
const CONFLICTING_PAIRS: readonly (readonly [RecommendationValue, RecommendationValue])[] = [
  ["strong_yes", "no"],
  ["strong_yes", "strong_no"],
  ["yes", "strong_no"],
];

const RECOMMENDATION_LABELS: Record<RecommendationValue, string> = {
  strong_yes: "strong yes",
  yes: "yes",
  unsure: "unsure",
  no: "no",
  strong_no: "strong no",
};

/**
 * Decides whether a candidacy needs another look, and says why in sentences.
 *
 * Flagging is transparent and threshold-driven (`docs/product-rules.md` §1):
 * nothing here judges the applicant, it only observes that the humans who did
 * judge them do not agree. The thresholds are cycle configuration (§7).
 *
 * The reasons are full sentences quoting the actual numbers because a committee
 * lead acts on this flag by reading it — a bare boolean or an error code would
 * make them go and reconstruct the arithmetic themselves.
 *
 * All applicable reasons accumulate; the first match does not short-circuit,
 * since a candidacy flagged for two different reasons is a different situation
 * from one flagged for either alone.
 */
export function detectDisagreement(input: DisagreementInput): DisagreementResult {
  const { scores, recommendations, spreadThreshold, flagOnExtremeConflict } = input;
  const reasons: string[] = [];

  // Null below two reviews: one review cannot disagree with itself.
  const spread = computeAggregate(scores).spread;
  if (spread !== null && spread >= spreadThreshold) {
    reasons.push(
      `Reviewer scores differ by ${spread} points, which meets the configured disagreement ` +
        `threshold of ${spreadThreshold} points.`,
    );
  }

  if (flagOnExtremeConflict) {
    const present = new Set(recommendations);
    const conflicts = CONFLICTING_PAIRS.filter(function bothPresent([positive, negative]) {
      return present.has(positive) && present.has(negative);
    });

    if (conflicts.length > 0) {
      const described = conflicts
        .map(function describe([positive, negative]) {
          const positiveLabel = RECOMMENDATION_LABELS[positive];
          const negativeLabel = RECOMMENDATION_LABELS[negative];

          return `a "${positiveLabel}" alongside a "${negativeLabel}"`;
        })
        .join(", and ");

      reasons.push(`Reviewers reached opposite extremes on this candidacy: ${described}.`);
    }
  }

  if (input.manuallyRequested === true) {
    reasons.push("A committee lead requested an additional review.");
  }

  return { flagged: reasons.length > 0, reasons };
}
