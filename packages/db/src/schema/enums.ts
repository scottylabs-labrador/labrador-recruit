import { pgEnum } from "drizzle-orm/pg-core";

/** Lifecycle of a recruitment cycle. Archived cycles are read-only. */
export const cycleStatus = pgEnum("cycle_status", [
  "draft",
  "open",
  "reviewing",
  "deciding",
  "archived",
]);

/**
 * Recruitment permissions, scoped to one cycle. Layered on top of the global
 * `admin | user | guest` role rather than replacing it: a global admin is not
 * automatically a recruitment admin.
 */
export const recruitmentRole = pgEnum("recruitment_role", [
  "reviewer",
  "committee_lead",
  "recruitment_admin",
]);

/** Normalised class year. `raw_year` retains whatever the form supplied. */
export const applicantYear = pgEnum("applicant_year", [
  "first_year",
  "sophomore",
  "junior",
  "senior",
  "grad",
  "unknown",
]);

/** How an answer should be rendered and validated. */
export const answerType = pgEnum("answer_type", [
  "short_text",
  "long_text",
  "url",
  "choice",
  "multi_choice",
  "rank",
  "boolean",
]);

/** Why a candidacy exists. Drives the default generation rules. */
export const candidacySource = pgEnum("candidacy_source", [
  "top_preference",
  "committee_question_opt_in",
  "manual",
]);

/** Where a candidacy sits in the review pipeline. */
export const candidacyStatus = pgEnum("candidacy_status", [
  "pending_assignment",
  "in_review",
  "needs_additional_review",
  "ready_for_decision",
  "decided",
]);

/**
 * Whether a rubric criterion is scored by a human or derived deterministically
 * from the applicant's own submitted committee ranking.
 */
export const criterionSource = pgEnum("criterion_source", ["reviewer", "application_preference"]);

/** State of one reviewer's assignment to one candidacy. */
export const assignmentStatus = pgEnum("assignment_status", [
  "assigned",
  "in_progress",
  "submitted",
  "conflicted",
  "cancelled",
]);

/** A reviewer's overall recommendation, collected alongside rubric scores. */
export const recommendation = pgEnum("recommendation", [
  "strong_yes",
  "yes",
  "unsure",
  "no",
  "strong_no",
]);

/** How confident the reviewer is in their own assessment. */
export const reviewConfidence = pgEnum("review_confidence", ["high", "medium", "low"]);

/** A committee's proposed outcome for a candidacy. Never final on its own. */
export const decisionStatus = pgEnum("decision_status", [
  "pending",
  "discuss",
  "accept",
  "waitlist",
  "reject",
  "redirect",
]);

/** The leadership-level outcome for an applicant across all committees. */
export const placementStatus = pgEnum("placement_status", [
  "pending",
  "placed",
  "waitlisted",
  "rejected",
  "declined",
]);

/** Progress of an uploaded spreadsheet through preview and commit. */
export const importStatus = pgEnum("import_status", [
  "pending",
  "previewed",
  "committed",
  "failed",
]);

/** Per-row outcome, so one malformed row cannot fail an entire batch. */
export const importRowStatus = pgEnum("import_row_status", [
  "pending",
  "imported",
  "updated",
  "skipped",
  "error",
]);
