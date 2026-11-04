import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth.ts";
import { cycleStatus, openingStatus } from "./enums.ts";
import { team } from "./org.ts";

/**
 * One recruitment round: `Fall 2026`, `Spring 2027`.
 *
 * The unit of historical isolation. Every opening, form, application, review and
 * decision belongs to exactly one cycle, so a past season stays inspectable and
 * cannot be mutated by anything happening in the current one.
 */
export const recruitmentCycle = pgTable(
  "recruitment_cycle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: cycleStatus("status").notNull().default("draft"),

    /**
     * The IANA zone the cycle's deadlines are expressed in.
     *
     * Stored rather than assumed, and every comparison is made server-side
     * against it. A browser clock is never the authority on whether
     * applications are open — it is attacker-controlled and, more often, simply
     * wrong.
     */
    timeZone: text("time_zone").notNull().default("America/New_York"),

    opensAt: timestamp("opens_at"),
    closesAt: timestamp("closes_at"),

    /** Null means an applicant may apply to as many committees as they like. */
    maxCommitteesPerApplicant: integer("max_committees_per_applicant"),

    /** Whether an applicant must rank the committees they apply to. */
    requirePreferenceRanking: boolean("require_preference_ranking").notNull().default(false),

    reviewOpensAt: timestamp("review_opens_at"),
    reviewClosesAt: timestamp("review_closes_at"),

    /**
     * Set by the release action, and the only thing that makes a decision
     * visible to an applicant.
     *
     * Preparing a decision notifies nobody. Release is a separate, explicit,
     * audited organization-level act.
     */
    decisionsReleasedAt: timestamp("decisions_released_at"),

    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("recruitment_cycle_slug_key").on(table.slug),

    // A window that closes before it opens is never what somebody meant, and
    // the symptom downstream is a cycle nobody can apply to for reasons that
    // look like a permissions bug.
    check(
      "recruitment_cycle_window_ck",
      sql`${table.opensAt} IS NULL OR ${table.closesAt} IS NULL OR ${table.closesAt} > ${table.opensAt}`,
    ),
    check(
      "recruitment_cycle_review_window_ck",
      sql`${table.reviewOpensAt} IS NULL OR ${table.reviewClosesAt} IS NULL OR ${table.reviewClosesAt} > ${table.reviewOpensAt}`,
    ),
    check(
      "recruitment_cycle_max_committees_ck",
      sql`${table.maxCommitteesPerApplicant} IS NULL OR ${table.maxCommitteesPerApplicant} > 0`,
    ),
  ],
);

/**
 * One committee's participation in one cycle.
 *
 * This is the join that makes multi-tenancy work: almost every scoped query
 * reaches a team through here, which is what lets one compiled predicate narrow
 * applicant data to the committees the caller holds a grant for.
 */
export const recruitmentOpening = pgTable(
  "recruitment_opening",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => recruitmentCycle.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),

    /**
     * Independent of the cycle's status, and starting closed.
     *
     * A cycle may be open while this committee's form is unpublished. An opening
     * accepts submissions only when the cycle *and* the opening both say so.
     */
    status: openingStatus("status").notNull().default("draft"),

    /** Narrower window than the cycle's, when a committee wants one. */
    opensAt: timestamp("opens_at"),
    closesAt: timestamp("closes_at"),

    /** Cap on accepted applications. Null means uncapped. */
    applicationLimit: integer("application_limit"),

    /** Target number of members to admit. Null means no target. */
    capacity: integer("capacity"),

    /** Overrides the cycle's required review count when set. */
    minimumReviews: integer("minimum_reviews"),

    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("recruitment_opening_cycle_team_key").on(table.cycleId, table.teamId),
    index("recruitment_opening_cycleId_idx").on(table.cycleId),
    index("recruitment_opening_teamId_idx").on(table.teamId),
    check(
      "recruitment_opening_window_ck",
      sql`${table.opensAt} IS NULL OR ${table.closesAt} IS NULL OR ${table.closesAt} > ${table.opensAt}`,
    ),
    check(
      "recruitment_opening_limits_ck",
      sql`(${table.applicationLimit} IS NULL OR ${table.applicationLimit} > 0)
          AND (${table.capacity} IS NULL OR ${table.capacity} > 0)
          AND (${table.minimumReviews} IS NULL OR ${table.minimumReviews} > 0)`,
    ),
  ],
);

export const recruitmentCycleRelations = relations(recruitmentCycle, ({ one, many }) => ({
  createdByUser: one(user, {
    fields: [recruitmentCycle.createdBy],
    references: [user.id],
  }),
  openings: many(recruitmentOpening),
}));

export const recruitmentOpeningRelations = relations(recruitmentOpening, ({ one }) => ({
  cycle: one(recruitmentCycle, {
    fields: [recruitmentOpening.cycleId],
    references: [recruitmentCycle.id],
  }),
  team: one(team, { fields: [recruitmentOpening.teamId], references: [team.id] }),
}));
