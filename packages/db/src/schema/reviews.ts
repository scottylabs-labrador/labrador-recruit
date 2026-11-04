import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { application } from "./applications.ts";
import { user } from "./auth.ts";
import { recruitmentOpening } from "./cycles.ts";
import {
  assignmentStatus,
  recommendation,
  reviewConfidence,
  reviewStatus,
  rubricStatus,
} from "./enums.ts";

/**
 * The criteria one committee scores against, as a version.
 *
 * A rubric locks once the first review is submitted against it, for the same
 * reason a published form version is immutable: a submitted review scored
 * against criteria that later changed is a review of something that no longer
 * exists. Revising criteria means a new version, and a review names the version
 * it was scored against.
 */
export const rubric = pgTable(
  "rubric",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    openingId: uuid("opening_id")
      .notNull()
      .references(() => recruitmentOpening.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: rubricStatus("status").notNull().default("draft"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("rubric_opening_version_key").on(table.openingId, table.version),

    // Which rubric a new review is scored against must never be ambiguous.
    uniqueIndex("rubric_one_active_key")
      .on(table.openingId)
      .where(sql`${table.status} = 'active'`),

    check("rubric_version_ck", sql`${table.version} > 0`),
    index("rubric_openingId_idx").on(table.openingId),
  ],
);

/** One scored dimension, with its range and weight. */
export const rubricCriterion = pgTable(
  "rubric_criterion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubric.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    minimumScore: integer("minimum_score").notNull(),
    maximumScore: integer("maximum_score").notNull(),

    /**
     * Relative weight in the aggregate.
     *
     * `numeric` rather than a float, because the aggregate has to be
     * reproducible by hand — see `docs/product-rules.md` section 2 — and binary
     * floating point makes that an argument about rounding.
     */
    weight: numeric("weight", { precision: 6, scale: 3 }).notNull().default("1"),

    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("rubric_criterion_rubric_name_key").on(table.rubricId, table.name),
    uniqueIndex("rubric_criterion_rubric_position_key").on(table.rubricId, table.position),

    // The parent side of `review_score`'s composite foreign key. A UNIQUE
    // constraint rather than an index, because drizzle emits constraints inline
    // in CREATE TABLE and every foreign key before any index.
    unique("rubric_criterion_rubric_id_key").on(table.rubricId, table.id),

    check("rubric_criterion_range_ck", sql`${table.maximumScore} > ${table.minimumScore}`),
    check("rubric_criterion_position_ck", sql`${table.position} > 0`),
  ],
);

/**
 * One reviewer's commission to review one application.
 *
 * A grant conveys standing; this conveys content. A reviewer holding a team
 * grant and no assignment can read nothing, and both conditions are required.
 */
export const reviewAssignment = pgTable(
  "review_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => application.id, { onDelete: "cascade" }),
    reviewerId: text("reviewer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    assignedBy: text("assigned_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    status: assignmentStatus("status").notNull().default("assigned"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
  },
  (table) => [
    /**
     * One live assignment per reviewer per application.
     *
     * Read the `WHERE` carefully. v1's equivalent index covered cancelled rows,
     * so reassigning a previously-cancelled reviewer returned 409 — and left 255
     * rows in that state, unfixable without a migration. Excluding cancelled
     * rows is the fix, and `reviews.test.ts` proves the reassignment works.
     */
    uniqueIndex("review_assignment_live_key")
      .on(table.applicationId, table.reviewerId)
      .where(sql`${table.status} <> 'cancelled'`),

    index("review_assignment_applicationId_idx").on(table.applicationId),
    index("review_assignment_reviewerId_idx").on(table.reviewerId),
  ],
);

/**
 * One reviewer's assessment of one application.
 *
 * `submittedAt` is load-bearing beyond record-keeping: submitting is what
 * unblinds this reviewer to their peers' reviews of the same application. A
 * draft does not unblind, which is why the status and the timestamp are checked
 * against each other.
 */
export const review = pgTable(
  "review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => reviewAssignment.id, { onDelete: "cascade" }),

    /** The rubric version this was scored against. */
    rubricId: uuid("rubric_id")
      .notNull()
      .references(() => rubric.id, { onDelete: "restrict" }),

    status: reviewStatus("status").notNull().default("draft"),
    recommendation: recommendation("recommendation"),
    confidence: reviewConfidence("confidence"),

    /** Private to staff. No student endpoint returns this field. */
    comments: text("comments"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("review_assignment_key").on(table.assignmentId),

    // The parent side of `review_score`'s composite foreign key, so the
    // database can check a score's criterion belongs to the rubric this review
    // was actually scored against. A UNIQUE constraint rather than an index,
    // for the same ordering reason as `rubric_criterion`'s.
    unique("review_id_rubric_key").on(table.id, table.rubricId),

    check(
      "review_submitted_at_ck",
      sql`(${table.status} = 'submitted' AND ${table.submittedAt} IS NOT NULL)
          OR (${table.status} <> 'submitted' AND ${table.submittedAt} IS NULL)`,
    ),

    index("review_rubricId_idx").on(table.rubricId),
  ],
);

/**
 * One score, against one criterion.
 *
 * `rubricId` is denormalized for the same reason `answer.formVersionId` is: it
 * is the column that lets a composite foreign key guarantee the criterion
 * belongs to the rubric this review was scored against, rather than to some
 * other version of it.
 *
 * Not guaranteed here, and worth knowing before #26: that a review's rubric
 * belongs to the same opening as its application. `review -> assignment ->
 * application -> opening` and `review -> rubric -> opening` are separate
 * chains. The review service has to check they agree, with a test for it.
 * Tying them in the schema would mean carrying `opening_id` on both
 * `review_assignment` and `review`.
 */
export const reviewScore = pgTable(
  "review_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reviewId: uuid("review_id").notNull(),
    rubricId: uuid("rubric_id").notNull(),
    criterionId: uuid("criterion_id").notNull(),
    score: integer("score").notNull(),
  },
  (table) => [
    foreignKey({
      name: "review_score_review_rubric_fk",
      columns: [table.reviewId, table.rubricId],
      foreignColumns: [review.id, review.rubricId],
    }).onDelete("cascade"),

    /*
     * `restrict`, not `cascade`.
     *
     * A score entered by a named human reviewer is the only input to every
     * aggregate this platform reports, and it cannot be recomputed. Cascading
     * would let a criterion deletion destroy it silently; refusing turns that
     * into an error somebody has to look at.
     */
    foreignKey({
      name: "review_score_rubric_criterion_fk",
      columns: [table.rubricId, table.criterionId],
      foreignColumns: [rubricCriterion.rubricId, rubricCriterion.id],
    }).onDelete("restrict"),

    uniqueIndex("review_score_review_criterion_key").on(table.reviewId, table.criterionId),
    index("review_score_reviewId_idx").on(table.reviewId),
  ],
);

export const rubricRelations = relations(rubric, ({ one, many }) => ({
  opening: one(recruitmentOpening, {
    fields: [rubric.openingId],
    references: [recruitmentOpening.id],
  }),
  criteria: many(rubricCriterion),
}));

export const rubricCriterionRelations = relations(rubricCriterion, ({ one }) => ({
  rubric: one(rubric, { fields: [rubricCriterion.rubricId], references: [rubric.id] }),
}));

export const reviewAssignmentRelations = relations(reviewAssignment, ({ one }) => ({
  application: one(application, {
    fields: [reviewAssignment.applicationId],
    references: [application.id],
  }),
  reviewer: one(user, { fields: [reviewAssignment.reviewerId], references: [user.id] }),
}));

export const reviewRelations = relations(review, ({ one, many }) => ({
  assignment: one(reviewAssignment, {
    fields: [review.assignmentId],
    references: [reviewAssignment.id],
  }),
  rubric: one(rubric, { fields: [review.rubricId], references: [rubric.id] }),
  scores: many(reviewScore),
}));

export const reviewScoreRelations = relations(reviewScore, ({ one }) => ({
  criterion: one(rubricCriterion, {
    fields: [reviewScore.criterionId],
    references: [rubricCriterion.id],
  }),
}));
