import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Every enum the schema uses, in one place.
 *
 * **Shared file: append-only and alphabetical within a group.** Both tracks add
 * to it, and a conflict in a file ordered any other way is one somebody has to
 * think about rather than resolve mechanically.
 */

/* -------------------------------------------------------------------------- */
/* Organization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A role a `permission_grant` confers.
 *
 * Layered on top of the global `admin | user | guest` role rather than
 * replacing it. Holding the ScottyLabs admin group lets somebody create a cycle
 * and issue grants; it does not let them read applicant data.
 */
export const grantRole = pgEnum("grant_role", [
  "org_admin",
  "committee_director",
  "question_editor",
  "reviewer",
]);

/**
 * What a grant applies to.
 *
 * `organization` grants carry no team; `team` grants must name one. The database
 * enforces that pairing with a CHECK, because a grant with the wrong shape is
 * either authority nobody intended or authority that silently applies nowhere.
 */
export const grantScope = pgEnum("grant_scope", ["organization", "team"]);

/* -------------------------------------------------------------------------- */
/* Cycles                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Where a cycle sits in its lifecycle.
 *
 * Unlike v1, where status was cosmetic apart from `archived`, these are
 * enforced: submission checks the cycle status server-side and every transition
 * is explicit and audited.
 */
export const cycleStatus = pgEnum("cycle_status", [
  "draft",
  "scheduled",
  "open",
  "closed",
  "reviewing",
  "decisions_released",
  "archived",
]);

/**
 * Whether one committee is accepting applications in one cycle.
 *
 * Deliberately independent of the cycle's own status. A cycle can be `open`
 * while a committee's form is still unpublished, and that committee simply does
 * not accept applications yet.
 */
export const openingStatus = pgEnum("opening_status", ["draft", "open", "closed"]);

/* -------------------------------------------------------------------------- */
/* Forms                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Who owns a form.
 *
 * `common` is the cycle's shared questions, owned by the organization and
 * answered once per applicant per cycle. `committee` is one opening's own.
 */
export const formKind = pgEnum("form_kind", ["common", "committee"]);

/**
 * Where a form version sits.
 *
 * `published` is immutable. `superseded` is a published version that a newer one
 * replaced, kept because responses still point at it.
 */
export const formVersionStatus = pgEnum("form_version_status", [
  "draft",
  "published",
  "superseded",
]);

/**
 * What a question asks for, and therefore how it renders and validates.
 *
 * `section_heading` and `static_content` carry no answer and are never required;
 * they exist so a long form can be broken up without a second mechanism.
 */
export const questionType = pgEnum("question_type", [
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "dropdown",
  "number",
  "url",
  "file_upload",
  "section_heading",
  "static_content",
]);

/* -------------------------------------------------------------------------- */
/* Applications                                                               */
/* -------------------------------------------------------------------------- */

/**
 * An application's internal status.
 *
 * What an applicant sees is a projection of this, not this value: `shortlisted`
 * surfaces to them as "Under Review". Track A writes up to `submitted`; Track B
 * writes everything after.
 */
export const applicationStatus = pgEnum("application_status", [
  "draft",
  "submitted",
  "under_review",
  "shortlisted",
  "interview",
  "decided",
  "withdrawn",
]);

/** Whether a set of answers is still being edited or has been finalized. */
export const formResponseStatus = pgEnum("form_response_status", ["draft", "submitted"]);

/* -------------------------------------------------------------------------- */
/* Reviews                                                                    */
/* -------------------------------------------------------------------------- */

/** Where a rubric version sits. `locked` is immutable. */
export const rubricStatus = pgEnum("rubric_status", ["draft", "active", "locked"]);

/**
 * State of one reviewer's commission.
 *
 * `cancelled` is excluded from the live-assignment unique index, so a reviewer
 * who was removed can be reassigned.
 */
export const assignmentStatus = pgEnum("assignment_status", [
  "assigned",
  "in_progress",
  "submitted",
  "conflicted",
  "cancelled",
]);

/** Whether a review is still being written or has been finalized. */
export const reviewStatus = pgEnum("review_status", ["draft", "submitted"]);

/** A reviewer's overall recommendation, alongside their rubric scores. */
export const recommendation = pgEnum("recommendation", [
  "strong_yes",
  "yes",
  "unsure",
  "no",
  "strong_no",
]);

/** How confident the reviewer is in their own assessment. */
export const reviewConfidence = pgEnum("review_confidence", ["high", "medium", "low"]);

/* -------------------------------------------------------------------------- */
/* Records                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What happened to an application.
 *
 * Offer, acceptance and confirmation are distinct events rather than values of
 * one status column, because the organization may need that workflow and
 * retrofitting it would mean rewriting decision history.
 */
export const statusEvent = pgEnum("status_event", [
  "created",
  "submitted",
  "withdrawn",
  "review_started",
  "shortlisted",
  "interview_invited",
  "offered",
  "accepted",
  "declined",
  "confirmed",
  "rejected",
  "waitlisted",
]);

/** Whether an upload has been validated and may be attached to an application. */
export const fileStatus = pgEnum("file_status", ["pending", "committed", "rejected"]);

/** Delivery state of one queued notification. */
export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "dead",
]);
