import type { RubricValidationIssue, RubricValidationResult, ScoringCriterion } from "./types.ts";

/**
 * Weights are stored as decimals, so a rubric of 0.30 + 0.20 + 0.20 + 0.15 +
 * 0.10 + 0.05 sums to 1.0000000000000002 in IEEE 754. The tolerance exists to
 * accept that, and is far tighter than any weight a human would configure, so a
 * genuinely wrong rubric still fails.
 */
const WEIGHT_SUM_EPSILON = 1e-6;

/**
 * Reports every problem with a rubric instead of throwing on the first one.
 *
 * Rubrics are database-backed configuration edited by committee leads (§7), so
 * the caller is an editing screen, not a crash site: a lead fixing three
 * mistakes should see all three at once rather than discovering them one save
 * at a time.
 *
 * Inactive criteria are excluded from the weight sum — that is what
 * deactivating a criterion means — but their keys and bounds are still checked,
 * because a lead can reactivate one at any time and a broken criterion must not
 * lie dormant waiting to corrupt scores.
 */
export function validateRubric(criteria: ScoringCriterion[]): RubricValidationResult {
  const issues: RubricValidationIssue[] = [];
  const seenKeys = new Set<string>();
  const reportedDuplicates = new Set<string>();

  for (const criterion of criteria) {
    if (seenKeys.has(criterion.key)) {
      if (!reportedDuplicates.has(criterion.key)) {
        reportedDuplicates.add(criterion.key);
        issues.push({
          code: "duplicate_key",
          message: `More than one criterion uses the key "${criterion.key}". Keys must be unique.`,
          criterionKey: criterion.key,
        });
      }
    } else {
      seenKeys.add(criterion.key);
    }

    if (criterion.weight < 0) {
      issues.push({
        code: "negative_weight",
        message:
          `Criterion "${criterion.key}" has a negative weight of ${criterion.weight}. ` +
          `Weights must be zero or greater.`,
        criterionKey: criterion.key,
      });
    }

    if (criterion.minScore >= criterion.maxScore) {
      issues.push({
        code: "invalid_bounds",
        message:
          `Criterion "${criterion.key}" has a minimum score of ${criterion.minScore} that is not ` +
          `below its maximum score of ${criterion.maxScore}.`,
        criterionKey: criterion.key,
      });
    }
  }

  const activeCriteria = criteria.filter(function isActive(criterion) {
    return criterion.active;
  });

  if (activeCriteria.length === 0) {
    // The weight sum is intentionally not reported here: "these weights do not
    // sum to 1" is noise when there are no weights to sum, and it would send a
    // lead looking for a second problem that does not exist.
    issues.push({
      code: "no_active_criteria",
      message: "The rubric has no active criteria, so no review score could be calculated.",
    });
  } else {
    const weightSum = activeCriteria.reduce(function addWeight(total, criterion) {
      return total + criterion.weight;
    }, 0);

    if (Math.abs(weightSum - 1) > WEIGHT_SUM_EPSILON) {
      issues.push({
        code: "weights_do_not_sum_to_one",
        message:
          `The active criteria weights sum to ${weightSum} rather than 1. ` +
          `Adjust the weights so they add up to exactly 1.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
