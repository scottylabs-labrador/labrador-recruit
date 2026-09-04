import type { components, paths } from "@labrador/server/build/swagger";

export type QueueItem = components["schemas"]["QueueItem"];
export type CandidacyReviewSummary = components["schemas"]["CandidacyReviewSummary"];
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

/** The caller's own recruitment standing in one cycle. */
export type MyStanding =
  paths["/recruitment/cycles/{cycleId}/me"]["get"]["responses"][200]["content"]["application/json"];

/* Spreadsheet import. */
export type ImportPreview = components["schemas"]["ImportPreviewSummary"];
export type ImportRowFailure = components["schemas"]["ImportRowFailure"];
export type ImportRowError = ImportRowFailure["errors"][number];
export type ImportCommitReport = components["schemas"]["ImportCommitReport"];
export type ImportSummary =
  paths["/recruitment/cycles/{cycleId}/imports"]["get"]["responses"][200]["content"]["application/json"][number];
export type ImportRowOutcome =
  paths["/recruitment/imports/{importId}/rows"]["get"]["responses"][200]["content"]["application/json"][number];

/* Rubric configuration. */
export type RubricVersionSummary = components["schemas"]["RubricVersionSummary"];
export type CriterionInput = components["schemas"]["CriterionInput"];
export type CriterionSource = "reviewer" | "application_preference";

/* Exports. */
export type RankingExportRow = components["schemas"]["RankingExportRow"];
export type DecisionExportRow = components["schemas"]["DecisionExportRow"];
export type ReviewerLoadExportRow = components["schemas"]["ReviewerLoadExportRow"];

export const CRITERION_SOURCE_OPTIONS: ReadonlyArray<{ value: CriterionSource; label: string }> = [
  { value: "reviewer", label: "Scored by the reviewer" },
  { value: "application_preference", label: "Derived from the applicant's preference" },
];

/**
 * Weights are decimals, so 0.30 + 0.20 + 0.20 + 0.15 + 0.10 + 0.05 sums to
 * 1.0000000000000002 in IEEE 754. This mirrors the tolerance
 * `@labrador/common`'s `validateRubric` uses on the server, so the editor's live
 * verdict and the server's verdict cannot disagree on a rubric a human typed.
 */
export const WEIGHT_SUM_EPSILON = 1e-6;

export function weightsSumToOne(total: number): boolean {
  return Math.abs(total - 1) <= WEIGHT_SUM_EPSILON;
}

/** Renders a fraction of 1 the way people discuss weights: as a percentage. */
export function formatWeightPercent(weight: number): string {
  if (Number.isNaN(weight)) return "—";
  return `${(weight * 100).toFixed(1)}%`;
}

/** Byte counts, for showing what is about to be uploaded. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A timestamp for a history table. Invalid or absent values read as an em dash. */
export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/**
 * The assignment statuses `/my-queue` can return. `cancelled` is deliberately
 * absent: the server excludes those rows, so offering it as a filter would only
 * ever produce an empty table.
 *
 * The spec types both `QueueItem.status` and the `status` query parameter as a
 * bare `string`, so this union is the only place the four values are checked.
 * Everything that filters or labels a queue row goes through it.
 */
export type QueueStatus = "assigned" | "in_progress" | "submitted" | "conflicted";

export type QueueStatusLabel = "Not started" | "Draft" | "Submitted" | "Conflicted";

export const QUEUE_STATUS_OPTIONS: ReadonlyArray<{
  value: QueueStatus;
  label: QueueStatusLabel;
}> = [
  { value: "assigned", label: "Not started" },
  { value: "in_progress", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "conflicted", label: "Conflicted" },
];

/** Narrows the spec's untyped `status` string before it is used as a filter. */
export function isQueueStatus(value: string): value is QueueStatus {
  return QUEUE_STATUS_OPTIONS.some((option) => option.value === value);
}

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

export function queueStatusLabel(item: QueueItem): QueueStatusLabel {
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

/**
 * Class year for display.
 *
 * The API returns the database enum verbatim (`first_year`), which is correct
 * on the wire but reads as a leaked implementation detail in a table a human
 * scans. Unknown values fall through unchanged rather than being hidden, so a
 * new enum member is visible rather than silently blank.
 */
const YEAR_LABELS: Record<string, string> = {
  first_year: "First Year",
  sophomore: "Sophomore",
  junior: "Junior",
  senior: "Senior",
  grad: "Grad",
  unknown: "Unknown",
};

export function yearLabel(value: string): string {
  return YEAR_LABELS[value] ?? value;
}

/**
 * Year values offered as a filter, in academic order rather than the
 * alphabetical order a `Record` would give. `unknown` is offered too: a year
 * the form did not supply is a real state someone may want to find and fix,
 * not a row to hide.
 */
export const YEAR_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "first_year", label: "First Year" },
  { value: "sophomore", label: "Sophomore" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
  { value: "grad", label: "Grad" },
  { value: "unknown", label: "Unknown" },
];

/**
 * Whether an applicant is being reviewed for a committee or merely ranked it.
 *
 * The distinction is the one that matters when chasing coverage: ranking a
 * committee is the applicant's stated preference, whereas a candidacy is what
 * generates review work. Someone who ranked a committee but has no candidacy
 * there is invisible to that committee's queue, and that is worth being able
 * to look for.
 */
export type CandidacyFilter = "all" | "with" | "without";

export const CANDIDACY_FILTER_OPTIONS: ReadonlyArray<{ value: CandidacyFilter; label: string }> = [
  { value: "all", label: "Any candidacy status" },
  { value: "with", label: "Has a candidacy" },
  { value: "without", label: "Ranked, but no candidacy" },
];

/**
 * Narrows a query-string year to one the filter offers. A URL is editable, and a
 * year nobody has would otherwise filter silently to nothing, which reads as a
 * bug rather than as a typo. Unknown values are treated as "all years".
 */
export function isYearFilter(value: string): boolean {
  return YEAR_FILTER_OPTIONS.some((option) => option.value === value);
}

export function isCandidacyFilter(value: string): value is CandidacyFilter {
  return CANDIDACY_FILTER_OPTIONS.some((option) => option.value === value);
}
