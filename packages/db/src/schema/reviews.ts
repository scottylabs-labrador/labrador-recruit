import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { committeeCandidacy } from "./applications.ts";
import { user } from "./auth.ts";
import { assignmentStatus, criterionSource, recommendation, reviewConfidence } from "./enums.ts";
import { committee, recruitmentCycle } from "./recruitment.ts";

/**
 * A versioned set of scoring criteria. Rubrics are never edited in place once
 * reviews exist against them; editing publishes a new version, so a submitted
 * review always retains the rubric it was scored under.
 */
export const rubric = pgTable(
  "rubric",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),

    /** Null means the rubric is the cycle default; set to override per committee. */
    committeeId: uuid("committee_id").references(() => committee.id, { onDelete: "cascade" }),

    version: integer("version").notNull().default(1),
    name: text("name").notNull(),

    /** Exactly one rubric per cycle-and-committee scope may be active. */
    active: boolean("active").notNull().default(true),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("rubric_scope_version_key").on(table.cycleId, table.committeeId, table.version),
    index("rubric_cycleId_idx").on(table.cycleId),
    index("rubric_committeeId_idx").on(table.committeeId),
  ],
);

/**
 * One weighted criterion. `weight` is a fraction of 1 stored with four decimal
 * places; the active criteria of a rubric must sum to 1.
 */
export const rubricCriterion = pgTable(
  "rubric_criterion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubric.id, { onDelete: "cascade" }),

    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),

    weight: numeric("weight", { precision: 6, scale: 4 }).notNull(),
    minScore: integer("min_score").notNull().default(1),
    maxScore: integer("max_score").notNull().default(5),
    displayOrder: integer("display_order").notNull().default(0),

    /**
     * `reviewer` criteria are entered by a human. `application_preference` is
     * derived from the applicant's own submitted ranking and is never a
     * judgement about their text.
     */
    source: criterionSource("source").notNull().default("reviewer"),

    /** Editable anchor text keyed by score, as `{ "1": "...", "5": "..." }`. */
    anchors: text("anchors"),

    active: boolean("active").notNull().default(true),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("rubric_criterion_rubric_key_key").on(table.rubricId, table.key),
    index("rubric_criterion_rubricId_idx").on(table.rubricId),
  ],
);

/** One reviewer's obligation to review one candidacy. */
export const reviewAssignment = pgTable(
  "review_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidacyId: uuid("candidacy_id")
      .notNull()
      .references(() => committeeCandidacy.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    status: assignmentStatus("status").notNull().default("assigned"),

    assignedAt: timestamp("assigned_at").notNull(),
    submittedAt: timestamp("submitted_at"),

    /**
     * Set when the reviewer declares a conflict. The reason is deliberately not
     * captured: reviewers must not have to disclose sensitive detail.
     */
    conflictedAt: timestamp("conflicted_at"),

    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // A reviewer is never assigned the same candidacy twice.
    uniqueIndex("review_assignment_candidacy_reviewer_key").on(
      table.candidacyId,
      table.reviewerUserId,
    ),
    index("review_assignment_candidacyId_idx").on(table.candidacyId),
    index("review_assignment_reviewerUserId_idx").on(table.reviewerUserId),
    index("review_assignment_status_idx").on(table.status),
  ],
);

/**
 * A reviewer's assessment. Exists as a draft from first save; `submittedAt`
 * distinguishes a draft from a submitted review, and only submitted reviews
 * contribute to aggregates or become visible to other reviewers.
 */
export const review = pgTable(
  "review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => reviewAssignment.id, { onDelete: "cascade" }),

    /** The rubric version this review was scored under, pinned at draft time. */
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubric.id, { onDelete: "restrict" }),

    recommendation: recommendation("recommendation"),
    confidence: reviewConfidence("confidence"),
    rationale: text("rationale"),

    /** Visible only to the authoring reviewer and to recruitment admins. */
    privateNotes: text("private_notes"),

    /** Neither flag affects any score. */
    discussionFlag: boolean("discussion_flag").notNull().default(false),
    underratedFlag: boolean("underrated_flag").notNull().default(false),

    /**
     * The weighted score normalised to 0-100, recomputed from `review_score`
     * rows on submission. Stored so ranking queries stay cheap; always
     * reproducible from the raw scores and the pinned rubric.
     */
    computedScore: numeric("computed_score", { precision: 6, scale: 2 }),

    submittedAt: timestamp("submitted_at"),
    reopenedAt: timestamp("reopened_at"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("review_assignment_key").on(table.assignmentId),
    index("review_rubricId_idx").on(table.rubricId),
    index("review_submittedAt_idx").on(table.submittedAt),
  ],
);

/** One criterion score within a review. */
export const reviewScore = pgTable(
  "review_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => review.id, { onDelete: "cascade" }),
    criterionId: uuid("criterion_id")
      .notNull()
      .references(() => rubricCriterion.id, { onDelete: "restrict" }),

    score: integer("score").notNull(),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("review_score_review_criterion_key").on(table.reviewId, table.criterionId),
    index("review_score_reviewId_idx").on(table.reviewId),
    index("review_score_criterionId_idx").on(table.criterionId),
  ],
);

export const rubricRelations = relations(rubric, ({ one, many }) => ({
  cycle: one(recruitmentCycle, {
    fields: [rubric.cycleId],
    references: [recruitmentCycle.id],
  }),
  committee: one(committee, {
    fields: [rubric.committeeId],
    references: [committee.id],
  }),
  criteria: many(rubricCriterion),
  reviews: many(review),
}));

export const rubricCriterionRelations = relations(rubricCriterion, ({ one, many }) => ({
  rubric: one(rubric, {
    fields: [rubricCriterion.rubricId],
    references: [rubric.id],
  }),
  scores: many(reviewScore),
}));

export const reviewAssignmentRelations = relations(reviewAssignment, ({ one }) => ({
  candidacy: one(committeeCandidacy, {
    fields: [reviewAssignment.candidacyId],
    references: [committeeCandidacy.id],
  }),
  reviewer: one(user, {
    fields: [reviewAssignment.reviewerUserId],
    references: [user.id],
  }),
  review: one(review),
}));

export const reviewRelations = relations(review, ({ one, many }) => ({
  assignment: one(reviewAssignment, {
    fields: [review.assignmentId],
    references: [reviewAssignment.id],
  }),
  rubric: one(rubric, {
    fields: [review.rubricId],
    references: [rubric.id],
  }),
  scores: many(reviewScore),
}));

export const reviewScoreRelations = relations(reviewScore, ({ one }) => ({
  review: one(review, {
    fields: [reviewScore.reviewId],
    references: [review.id],
  }),
  criterion: one(rubricCriterion, {
    fields: [reviewScore.criterionId],
    references: [rubricCriterion.id],
  }),
}));
