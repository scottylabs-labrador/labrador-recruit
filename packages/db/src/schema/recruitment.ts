import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { cycleStatus, recruitmentRole } from "./enums.ts";

/**
 * One recruitment season, for example "Fall 2026". Every application, rubric,
 * review, assignment, ranking, and decision belongs to exactly one cycle, so a
 * past season stays inspectable without contaminating the current one.
 */
export const recruitmentCycle = pgTable(
  "recruitment_cycle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: cycleStatus("status").notNull().default("draft"),
    opensAt: timestamp("opens_at"),
    closesAt: timestamp("closes_at"),

    /** Reviews required per candidacy before it is ready for a decision. */
    minimumReviews: integer("minimum_reviews").notNull().default(3),

    /** Hides applicant identity from ordinary reviewers when enabled. */
    blindReviewEnabled: boolean("blind_review_enabled").notNull().default(false),

    /**
     * Restricts the whole interface to one committee when set.
     *
     * A deployment can be stood up for a single committee - Labrador reviewing
     * only its own applicants - without deleting the other committees'
     * candidacies or anyone's submitted preferences. Those stay in the
     * database, so widening back out later is a settings change rather than a
     * re-import. Null means every committee the cycle runs is in scope.
     *
     * This is presentation and scoping, not authorisation: access control
     * still comes from `recruitment_membership`, and narrowing this can never
     * widen what somebody may read.
     */
    reviewCommitteeId: uuid("review_committee_id").references(() => committee.id, {
      onDelete: "set null",
    }),

    /**
     * How many of an applicant's ranked committees receive a candidacy by
     * default. Admins may still add or remove candidacies by hand.
     */
    candidacyTopN: integer("candidacy_top_n").notNull().default(3),

    /** Also create a candidacy for any committee whose questions were answered. */
    candidacyIncludeOptIns: boolean("candidacy_include_opt_ins").notNull().default(true),

    /**
     * Mean score at or above which leadership intends to admit, and below
     * which they intend to reject. Null means no line has been drawn.
     *
     * These draw two lines on the ranking and let an administrator select
     * everyone above one of them. They never apply themselves: product rule 1
     * forbids an automatic accept or reject "including by numeric cutoff", so
     * the cutoff proposes and a named person decides. They live on the cycle
     * rather than in code because recruitment policy changes between rounds.
     */
    decisionCutoffAdmit: integer("decision_cutoff_admit"),
    decisionCutoffReject: integer("decision_cutoff_reject"),

    /** Score spread, in normalised points, above which reviewers disagree. */
    disagreementSpreadThreshold: integer("disagreement_spread_threshold").notNull().default(20),

    /** Flag a candidacy when recommendations span a positive and negative extreme. */
    disagreementOnExtremeConflict: boolean("disagreement_on_extreme_conflict")
      .notNull()
      .default(true),

    /**
     * Maps a submitted committee rank to a 1-5 preference score, as
     * `{ "1": 5, "2": 4, ... }`. Stored per cycle so leadership can revise it
     * without a code change.
     */
    preferenceScoreMap: jsonb("preference_score_map").notNull(),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("recruitment_cycle_slug_key").on(table.slug)],
);

/**
 * A ScottyLabs committee. Global rather than per-cycle so that a committee
 * keeps its identity across seasons; per-cycle configuration lives on
 * {@link cycleCommittee}.
 */
export const committee = pgTable(
  "committee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("committee_slug_key").on(table.slug)],
);

/** Participation of a committee in one cycle, with its capacity and overrides. */
export const cycleCommittee = pgTable(
  "cycle_committee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),
    committeeId: uuid("committee_id")
      .notNull()
      .references(() => committee.id, { onDelete: "cascade" }),

    /** Target number of accepted members. Null means uncapped. */
    capacity: integer("capacity"),

    /** Overrides the cycle's `minimumReviews` when set. */
    minimumReviews: integer("minimum_reviews"),

    settings: jsonb("settings"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("cycle_committee_cycle_committee_key").on(table.cycleId, table.committeeId),
    index("cycle_committee_cycleId_idx").on(table.cycleId),
    index("cycle_committee_committeeId_idx").on(table.committeeId),
  ],
);

/**
 * Grants an authenticated user a recruitment role within one cycle. A
 * `committeeId` scopes the role to a single committee; null means it applies
 * across the cycle, which is how recruitment admins are represented.
 */
export const recruitmentMembership = pgTable(
  "recruitment_membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: recruitmentRole("role").notNull(),
    committeeId: uuid("committee_id").references(() => committee.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Postgres treats NULLs as distinct in a unique index, so a cycle-wide
    // membership (null committee) is deduplicated by its own partial index below.
    uniqueIndex("recruitment_membership_scoped_key")
      .on(table.cycleId, table.userId, table.role, table.committeeId)
      .where(sql`${table.committeeId} IS NOT NULL`),
    uniqueIndex("recruitment_membership_cycle_wide_key")
      .on(table.cycleId, table.userId, table.role)
      .where(sql`${table.committeeId} IS NULL`),
    index("recruitment_membership_cycleId_idx").on(table.cycleId),
    index("recruitment_membership_userId_idx").on(table.userId),
    index("recruitment_membership_committeeId_idx").on(table.committeeId),
  ],
);

export const recruitmentCycleRelations = relations(recruitmentCycle, ({ many }) => ({
  cycleCommittees: many(cycleCommittee),
  memberships: many(recruitmentMembership),
}));

export const committeeRelations = relations(committee, ({ many }) => ({
  cycleCommittees: many(cycleCommittee),
  memberships: many(recruitmentMembership),
}));

export const cycleCommitteeRelations = relations(cycleCommittee, ({ one }) => ({
  cycle: one(recruitmentCycle, {
    fields: [cycleCommittee.cycleId],
    references: [recruitmentCycle.id],
  }),
  committee: one(committee, {
    fields: [cycleCommittee.committeeId],
    references: [committee.id],
  }),
}));

export const recruitmentMembershipRelations = relations(recruitmentMembership, ({ one }) => ({
  cycle: one(recruitmentCycle, {
    fields: [recruitmentMembership.cycleId],
    references: [recruitmentCycle.id],
  }),
  user: one(user, {
    fields: [recruitmentMembership.userId],
    references: [user.id],
  }),
  committee: one(committee, {
    fields: [recruitmentMembership.committeeId],
    references: [committee.id],
  }),
}));
