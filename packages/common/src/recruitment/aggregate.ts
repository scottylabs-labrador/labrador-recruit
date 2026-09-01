import { roundToTwoDecimals } from "./round.ts";
import type { AggregateResult } from "./types.ts";

/**
 * Descriptive statistics over the submitted reviews of one candidacy.
 *
 * Only the statistics `docs/product-rules.md` §1 permits are computed, and each
 * one is reproducible by hand from the same review scores a committee lead can
 * see listed beside it (§2).
 *
 * Standard deviation is the POPULATION formula (divide by N). The submitted
 * reviews are not a sample drawn from some larger pool of reviews that might
 * have happened — they are the complete set of reviews that exist for this
 * candidacy, so Bessel's correction would be correcting for a sampling process
 * that never took place. It also keeps the number reproducible by hand without
 * anyone having to remember whether to use N or N-1.
 *
 * Spread and standard deviation are null below two reviews because "how much do
 * reviewers disagree" is not a question a single review can answer, and a
 * displayed zero would read as agreement.
 */
export function computeAggregate(scores: number[]): AggregateResult {
  const count = scores.length;

  if (count === 0) {
    return {
      count: 0,
      mean: null,
      median: null,
      min: null,
      max: null,
      spread: null,
      standardDeviation: null,
    };
  }

  const sorted = [...scores].sort(function ascending(a, b) {
    return a - b;
  });

  const min = sorted[0];
  const max = sorted[count - 1];
  if (min === undefined || max === undefined) {
    throw new Error("Unreachable: a non-empty score list always has a first and last value.");
  }

  const total = sorted.reduce(function add(sum, score) {
    return sum + score;
  }, 0);
  const exactMean = total / count;

  return {
    count,
    mean: roundToTwoDecimals(exactMean),
    median: roundToTwoDecimals(medianOfSorted(sorted)),
    // Min and max are review scores a human can point at in the list, so they
    // are reported exactly as recorded rather than re-rounded.
    min,
    max,
    spread: count < 2 ? null : roundToTwoDecimals(max - min),
    standardDeviation: count < 2 ? null : roundToTwoDecimals(populationStdDev(sorted, exactMean)),
  };
}

/** Even counts average the two middle values so the median sits between them. */
function medianOfSorted(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    const value = sorted[middle];
    if (value === undefined) {
      throw new Error("Unreachable: the middle index of a non-empty list always exists.");
    }

    return value;
  }

  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) {
    throw new Error("Unreachable: an even-length list always has two middle values.");
  }

  return (lower + upper) / 2;
}

/** Uses the unrounded mean so the deviation is not compounded by display rounding. */
function populationStdDev(scores: number[], exactMean: number): number {
  const squaredDeviations = scores.reduce(function addSquaredDeviation(sum, score) {
    return sum + (score - exactMean) ** 2;
  }, 0);

  return Math.sqrt(squaredDeviations / scores.length);
}
