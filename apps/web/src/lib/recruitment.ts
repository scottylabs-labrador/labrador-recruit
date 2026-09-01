import type { components } from "@labrador/server/build/swagger";

export type QueueItem = components["schemas"]["QueueItem"];
export type ReviewDetail = components["schemas"]["ReviewDetail"];
export type CycleSummary = components["schemas"]["CycleSummary"];
export type CommitteeSummary = components["schemas"]["CommitteeSummary"];
export type RubricCriterionSummary = components["schemas"]["RubricCriterionSummary"];
export type CandidacyAggregate = components["schemas"]["CandidacyAggregate"];
export type RankingRow = components["schemas"]["RankingRow"];
export type ApplicationListItem = components["schemas"]["ApplicationListItem"];
export type ApplicationDetail = components["schemas"]["ApplicationDetail"];
export type AnswerSection = components["schemas"]["AnswerSection"];
export type RecommendationValue = components["schemas"]["RecommendationValue"];
export type ConfidenceValue = "high" | "medium" | "low";
export type SaveReviewRequest = components["schemas"]["SaveReviewRequest"];

/** Assignment statuses, as the server's `status` query parameter accepts them. */
export type AssignmentStatus = "assigned" | "in_progress" | "submitted" | "conflicted";

export const QUEUE_STATUS_OPTIONS: ReadonlyArray<{ value: AssignmentStatus; label: string }> = [
  { value: "assigned", label: "Not started" },
  { value: "in_progress", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "conflicted", label: "Conflicted" },
];

export const RECOMMENDATION_OPTIONS: ReadonlyArray<{
  value: RecommendationValue;
  label: string;
}> = [
  { value: "strong_yes", label: "Strong Yes" },
  { value: "yes", label: "Yes" },
  { value: "unsure", label: "Unsure" },
  { value: "no", label: "No" },
  { value: "strong_no", label: "Strong No" },
];

export const CONFIDENCE_OPTIONS: ReadonlyArray<{ value: ConfidenceValue; label: string }> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/** The placeholder shown wherever blind review has withheld applicant identity. */
export const HIDDEN_APPLICANT_LABEL = "Hidden";

export function applicantLabel(name: string | null): string {
  return name ?? HIDDEN_APPLICANT_LABEL;
}

export function recommendationLabel(value: string | null): string {
  if (value === null) return "Not given";
  return RECOMMENDATION_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function confidenceLabel(value: string | null): string {
  if (value === null) return "Not given";
  return CONFIDENCE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function queueStatusLabel(item: QueueItem): string {
  if (item.status === "conflicted") return "Conflicted";
  if (item.submitted || item.status === "submitted") return "Submitted";
  if (item.hasDraft || item.status === "in_progress") return "Draft";
  return "Not started";
}

/** Renders a nullable statistic without ever inventing a zero for missing data. */
export function formatStatistic(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function formatRank(rank: number | null): string {
  return rank === null ? "—" : `#${rank}`;
}

/**
 * Reads a count out of the server's `Record<string, number>` maps. Index access
 * is widened to `undefined` under `noUncheckedIndexedAccess`, so the fallback is
 * not decorative.
 */
export function countFor(counts: Record<string, number>, key: string): number {
  return counts[key] ?? 0;
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/**
 * Whether an answer is a URL the applicant supplied. Product rules forbid the
 * platform from fetching these, so they are only ever rendered as inert text
 * inside an anchor the reviewer has to click themselves.
 */
export function isExternalLink(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}
